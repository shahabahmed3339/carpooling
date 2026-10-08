# Carpool Pakistan web app

Users create an account with email verification and choose Rider or Driver as the starting dashboard. A single account can switch modes at any time. Signup does not require an invitation, community choice, sponsor, or operator approval. The database retains an internal shared marketplace scope that users never manage.

## Local setup

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL`, `DATABASE_SSL`, `AUTH_SECRET` (random, at least 32 characters), `BETTER_AUTH_URL=http://localhost:3000`, and `AUTH_ENABLED=true`.
3. Apply migrations to the intended development database: `npm run db:migrate`. The runner is checksum-checked and serializes concurrent runs. Migrations 0006 and 0007 support the open marketplace and normalized area search.
4. Start the app: `npm run dev`.
5. Open `http://localhost:3000/login`, enter a name and email, choose the initial mode, and submit. In local development on localhost, the one-time sign-in link is printed in the terminal running `npm run dev`.
6. Open that link, then switch Rider/Driver using the dashboard toggle.

For hosted/non-local environments, configure a verified email sender with `RESEND_API_KEY` and `AUTH_EMAIL_FROM`, use HTTPS for `BETTER_AUTH_URL`, and keep secrets out of source control. Do not expose local terminal-link behavior to a deployed environment.

## Main flows

- **Rider:** search for a dated trip, request a seat, view/cancel requests.
- **Driver:** save/edit a commute, publish a specific trip date, review and accept/decline requests.
- A seat request is not confirmed until the driver accepts it.
- The mode is a dashboard/action context, not an account type. Both kinds of records belong to the same account.
- Area matching ignores capitalization and repeated spaces, but neighborhood names must still match; the app does not yet match nearby areas geographically.
- Users can block/unblock participants. Blocking affects future matching and new request acceptance; it does not cancel existing trips or requests.
- Users can report a participant they share a trip or request with, and see the status of their own reports. The reviewer queue is at `/moderation/reports` and is limited to accounts whose membership role is `OPERATOR` or `SAFETY_REVIEWER`; assigning that role is a manual database step. Nothing sends an alert, so the queue must be checked deliberately.
- After departure, each side confirms the trip happened; the request completes only when both confirm. If the completion window lapses, the request expires and the app records which side had confirmed, visible to reviewers as "Unconfirmed trips". This is context for a human, not a penalty: someone may have travelled and never reopened the app.
- Users can close their own account from the dashboard. Open requests are withdrawn, future trips cancelled, identifying fields erased, and sessions deleted; completed history is retained against an anonymous account row.

## Database

Migrations live in `db/migrations`. `npm run db:migrate` applies unapplied migrations atomically, checks checksums, and uses an advisory lock. It changes only the database specified by `DATABASE_URL`; check that URL before running. Migration 0006 creates the automatic marketplace scope and activates existing accounts in it; 0007 adds an index for normalized area matching; 0008 adds safety reports; 0009 adds account closure; 0010 adds trip completion and disputes; 0011 backfills capacity on already-closed trips; 0012 adds unconfirmed-trip evidence. Do not run migrations against a shared/production database unless that is the intended operation.

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

This implementation supports local product-flow testing. It does not verify identity, driving eligibility, vehicle condition, or user trust; it does not provide emergency response or trip monitoring. Reporting, blocking, and account closure exist, but nothing sends an alert and no one is paged.

Not implemented: no-show *policy*. Unconfirmed completions are recorded and shown to reviewers, but nothing acts on them — there is no threshold, warning, suspension, or appeal path, so the data must currently be read as context during a human review rather than as a determination. There are also no notifications, so users see changes only after reloading.

Before facilitating real rides, complete a staffed support route, a retention schedule for closed accounts and reports, cancellation/no-show/cost-sharing terms, incident response, and applicable local review. See repository-level `MVP_SPEC.md` and `SAFETY_PRIVACY.md`.
