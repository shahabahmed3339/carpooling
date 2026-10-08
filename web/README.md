# Carpool Pakistan web app

Users create an account with email verification and choose Rider or Driver as the starting dashboard. A single account can switch modes at any time. Signup does not require an invitation, community choice, sponsor, or operator approval. The database retains an internal shared marketplace scope that users never manage.

## Local setup

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL`, `DATABASE_SSL`, `AUTH_SECRET` (random, at least 32 characters), `BETTER_AUTH_URL=http://localhost:3000`, and `AUTH_ENABLED=true`.
3. Apply migrations to the intended development database: `npm run db:migrate`. The runner is checksum-checked and serializes concurrent runs. The current schema includes open-marketplace access, normalized area search, account closure, ride completion, notifications, and safety-report history.
4. Start the app: `npm run dev`.
5. Open `http://localhost:3000/login`, enter a name and email, choose the initial mode, and submit. In local development on localhost, the one-time sign-in link is printed in the terminal running `npm run dev`.
6. Open that link, then switch Rider/Driver using the dashboard toggle.

For hosted/non-local environments, configure a verified email sender with `RESEND_API_KEY` and `AUTH_EMAIL_FROM`, use HTTPS for `BETTER_AUTH_URL`, and keep secrets out of source control. Do not expose local terminal-link behavior to a deployed environment.

## Main flows

- **Rider:** search for a dated trip, request a seat, view/cancel requests.
- **Driver:** save/edit a commute, publish a specific trip date, review and accept/decline requests.
- A seat request is not confirmed until the driver accepts it.
- The mode is a dashboard/action context, not an account type. Both kinds of records belong to the same account.
- Mode changes are serialized against role-gated writes; other open tabs reload after a switch, and the server rejects a stale-mode action even if a tab has not refreshed yet.
- Area matching ignores capitalization and repeated spaces, but neighborhood names must still match; the app does not yet match nearby areas geographically.
- Users can block/unblock participants. Blocking affects future matching and new request acceptance; it does not cancel existing trips or requests.
- Users can report a participant they share a trip or request with, and see the status of their own reports. The reviewer queue is at `/moderation/reports` and is limited to accounts whose membership role is `OPERATOR` or `SAFETY_REVIEWER`; assigning that role is a manual database step. Since no external alert is sent, the queue must be checked deliberately.
- Ride and safety-report events create in-app notifications. The dashboard inbox refreshes while visible and can load older entries. Reviewers can inspect a report's status history and recent closed reports; their queue refreshes on focus and every 30 seconds while visible. None of these features pages a human or sends email/SMS/push alerts.
- After departure, each side confirms the trip happened; the request completes only when both confirm. If the completion window lapses, the request expires and the app records which side had confirmed, visible to reviewers as "Unconfirmed trips". This is context for a human, not a penalty: someone may have travelled and never reopened the app.
- Users can close their own account from the dashboard. Open requests are withdrawn and accepted seats released, future trips cancelled with in-app notices to affected riders/drivers, the app identity is anonymized, Better Auth identity/credentials/sessions and outstanding magic-link tokens for that email are deleted, and completed history is retained against the anonymous app row.

## Database

Migrations live in `db/migrations`. `npm run db:migrate` applies unapplied migrations atomically, checks checksums, and uses an advisory lock. It changes only the database specified by `DATABASE_URL`; check that URL before running. Migration 0006 creates the automatic marketplace scope; 0007 indexes normalized area matching; 0008 adds safety reports; 0009 adds account closure; 0010–0012 add trip completion, capacity repair, and unconfirmed-trip evidence; 0013–0015 add in-app notifications; 0016 adds reviewer-only safety-report history and labels existing report rows as snapshots; 0017 prevents audit events from being updated, deleted, or truncated. Migration 0017 is authored but must still be applied to each intended database. Do not run migrations against a shared/production database unless that is the intended operation.

Mutation idempotency results are retained for 24 hours. `npm run db:prune-idempotency` removes at most 500 expired rows per invocation using row locks that skip work held by another transaction. Schedule it periodically in the intended environment; invoke it repeatedly if a backlog exceeds one batch. The command deletes expired idempotency receipts and should only be pointed at the intended database.

Two checks assert behaviour against live data rather than page text:

```bash
node scripts/verify-completion.mjs   # schema invariants; exits non-zero if any fail
node scripts/verify-no-show.mjs      # expiry evidence path, end to end (self-cleaning)
```

To review reports, promote an account manually after it has signed in once:

```sql
UPDATE community_memberships SET role = 'SAFETY_REVIEWER', updated_at = now()
 WHERE user_id = (SELECT id FROM users WHERE auth_subject = '<auth subject>');
```

There is no UI for granting this role, by design: it should be a deliberate operator action, not something a user can self-assign.

## Readiness limits

This implementation supports local product-flow testing. It does not verify identity, driving eligibility, vehicle condition, or user trust; it does not provide emergency response or trip monitoring. In-app notices do not guarantee that a reviewer is online or watching the queue; no email/SMS/push alerts or paging are configured.

Not implemented: no-show *policy*. Unconfirmed completions are recorded and shown to reviewers, but nothing acts on them — there is no threshold, warning, suspension, or appeal path, so the data must currently be read as context during a human review rather than as a determination. In-app notifications are periodic rather than real-time, and external alert channels are not configured.

Before facilitating real rides, complete a staffed support route, a retention schedule for closed accounts and reports, cancellation/no-show/cost-sharing terms, incident response, and applicable local review. See repository-level `MVP_SPEC.md` and `SAFETY_PRIVACY.md`.
