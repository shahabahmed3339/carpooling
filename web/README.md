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
- **Driver:** save/edit a commute, publish a specific trip date, review and accept/decline requests. A commute may carry an optional free-text cost-sharing note (≤160 characters), shown to riders in search; it is copied to each published trip and is display-only — the app handles no money.
- A seat request is not confirmed until the driver accepts it.
- The mode is a dashboard/action context, not an account type. Both kinds of records belong to the same account.
- Mode changes are serialized against role-gated writes; other open tabs reload after a switch, and the server rejects a stale-mode action even if a tab has not refreshed yet.
- Area matching ignores capitalization and repeated spaces, but neighborhood names must still match; the app does not yet match nearby areas geographically.
- Users can block/unblock participants. Blocking affects future matching and new request acceptance; it does not cancel existing trips or requests.
- Users can report a participant they share a trip or request with, and see the status of their own reports. The reviewer queue is at `/moderation/reports` and is limited to accounts whose membership role is `OPERATOR` or `SAFETY_REVIEWER`; assigning that role is a manual step (`npm run db:set-reviewer-role`). Since no external alert is sent, the queue must be checked deliberately.
- Either participant can report that an accepted trip did not happen as agreed. It moves to `DISPUTED`, notifies active reviewers, and appears in the same moderation page; a reviewer records only whether the trip happened (`COMPLETED` or `EXPIRED`) and both participants are notified. Nothing is penalized automatically.
- Ride and safety-report events create in-app notifications. The dashboard inbox refreshes while visible and can load older entries. Reviewers can inspect a report's status history and recent closed reports; their queue refreshes on focus and every 30 seconds while visible. None of these features pages a human or sends email/SMS/push alerts.
- After departure, each side confirms the trip happened; the request completes only when both confirm. If the completion window lapses, the request expires and the app records which side had confirmed, visible to reviewers as "Unconfirmed trips". This is context for a human, not a penalty: someone may have travelled and never reopened the app.
- Users can close their own account from the dashboard. Open requests are withdrawn and accepted seats released, future trips cancelled with in-app notices to affected riders/drivers, the app identity is anonymized, Better Auth identity/credentials/sessions and outstanding magic-link tokens for that email are deleted, and completed history is retained against the anonymous app row. Closure is refused while a trip the user is part of has already departed. The transaction logic and its privacy/capacity invariants are covered by `npm run verify:account-closure`.

## Database

Migrations live in `db/migrations`. `npm run db:migrate` applies unapplied migrations atomically, checks checksums, and uses an advisory lock. It changes only the database specified by `DATABASE_URL`; check that URL before running. Migration 0006 creates the automatic marketplace scope; 0007 indexes normalized area matching; 0008 adds safety reports; 0009 adds account closure; 0010–0012 add trip completion, capacity repair, and unconfirmed-trip evidence; 0013–0015 add in-app notifications; 0016 adds reviewer-only safety-report history; 0017/0019 add the append-only UPDATE/DELETE and TRUNCATE guards; 0018 adds the reviewer trip-dispute notification kind; 0020 indexes read notifications by age for retention cleanup; 0021 adds the optional display-only cost-sharing note. Do not run migrations against a shared/production database unless that is the intended operation.

If a migration file is edited after it was applied, the runner refuses to continue (it would silently apply a different schema than the database holds). After verifying the live schema by hand, reconcile only that file with `node ./scripts/migrate.mjs --rebaseline-checksum=<filename>`; it records the new checksum and does not re-run any SQL. Use it deliberately, and prefer a new migration whenever the change is not purely documentary.

Reviewer access is granted with `npm run db:set-reviewer-role -- <email> <MEMBER|OPERATOR|SAFETY_REVIEWER>`.

Mutation idempotency results are retained for 24 hours. `npm run db:prune-idempotency` removes at most 500 expired rows per invocation using row locks that skip work held by another transaction. Schedule it periodically in the intended environment; invoke it repeatedly if a backlog exceeds one batch.

Old in-app notifications are pruned with `npm run db:prune-notifications`. It removes at most 500 rows per invocation, and only notifications the recipient has already **read** and only once older than the retention window (default 90 days; override with `--retention-days=<n>` or `NOTIFICATION_RETENTION_DAYS`). Unread and recent notices are never eligible. Use `--dry-run` to see the eligible count without deleting. Schedule both cleanup commands periodically.

Retention across the rest of the data is not yet applied anywhere. `npm run db:audit-retention` reports how much closed-account, report, dispute, trip and notification data exists at a given age (e.g. `--as-of-days=90`), so the window can be chosen from real volume. It runs inside a read-only transaction and changes nothing; PostgreSQL rejects any write in that transaction, so it cannot delete by mistake.

Two checks assert behaviour against live data rather than page text:

```bash
node scripts/verify-completion.mjs       # schema invariants; exits non-zero if any fail
node scripts/verify-no-show.mjs          # expiry evidence path, end to end (self-cleaning)
node scripts/verify-dispute.mjs          # dispute raise/resolve guards, end to end (self-cleaning)
node scripts/verify-account-closure.mjs  # closure refusal, seat release, PII erase (self-cleaning)
node scripts/verify-notifications.mjs    # event-key dedup, pagination, read state (self-cleaning)
node scripts/verify-concurrency.mjs      # parallel accepts, double-accept, accept-vs-cancel (self-cleaning)
node scripts/verify-contribution.mjs     # cost-sharing note copy-on-publish rules (self-cleaning)
node scripts/verify-integrity.mjs        # cross-table integrity for disputes/reports/closure (read-only)
node scripts/verify-reviewer-role.mjs    # reviewer-role grant/refuse paths (self-cleaning)
```

To review reports and disputes, promote an account with the bundled command after it has signed in once:

```bash
npm run db:set-reviewer-role -- reviewer@example.com SAFETY_REVIEWER
```

Use `OPERATOR` for the same access, or `MEMBER` to remove it. The command only promotes an existing **active** account and only changes its membership role; a closed account cannot regain access. There is no UI for granting this role, by design: it should be a deliberate operator action, not something a user can self-assign. If you prefer SQL, the equivalent is `UPDATE community_memberships SET role = 'SAFETY_REVIEWER', updated_at = now() WHERE user_id = (SELECT u.id FROM users u WHERE u.auth_subject = (SELECT au.id FROM "user" au WHERE lower(au.email) = lower('reviewer@example.com')) AND u.status = 'ACTIVE');`. Note the `"user"` table's primary key is `id`; `userId` exists only on `account`/`session` as a foreign key.

## Readiness limits

This implementation supports local product-flow testing. It does not verify identity, driving eligibility, vehicle condition, or user trust; it does not provide emergency response or trip monitoring. In-app notices do not guarantee that a reviewer is online or watching the queue; no email/SMS/push alerts or paging are configured.

Not implemented: no-show *policy*. Unconfirmed completions are recorded and shown to reviewers, but nothing acts on them — there is no threshold, warning, suspension, or appeal path, so the data must currently be read as context during a human review rather than as a determination. Trip disputes have a human review path but equally carry no automatic consequence. In-app notifications are periodic rather than real-time, and external alert channels are not configured.

Before facilitating real rides, complete a staffed support route, a retention schedule for closed accounts and reports, cancellation/no-show/cost-sharing terms, incident response, and applicable local review. See repository-level `MVP_SPEC.md` and `SAFETY_PRIVACY.md`.
