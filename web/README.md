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
- Area matching ignores capitalization and repeated spaces. Two differently spelled areas also match when an operator declares an alias between them, and — once an operator records a coordinate for both areas — when they are within a server-configured radius (default 2 km). Distance applies only to areas an operator has placed; nothing is inferred from a name, and a distance-based result is labelled as such to the rider. See "Area coordinates" at `/moderation/reports`.
- Users can block/unblock participants. Blocking affects future matching and new request acceptance; it does not cancel existing trips or requests.
- Users can report a participant they share a trip or request with, and see the status of their own reports. The reviewer queue is at `/moderation/reports` and is limited to accounts whose membership role is `OPERATOR` or `SAFETY_REVIEWER`; assigning that role is a manual step (`npm run db:set-reviewer-role`). Since no external alert is sent, the queue must be checked deliberately.
- Either participant can report that an accepted trip did not happen as agreed. It moves to `DISPUTED`, notifies active reviewers, and appears in the same moderation page; a reviewer records only whether the trip happened (`COMPLETED` or `EXPIRED`) and both participants are notified. Nothing is penalized automatically.
- Ride and safety-report events create in-app notifications. The dashboard inbox refreshes while visible and can load older entries. Reviewers can inspect a report's status history and recent closed reports; their queue refreshes on focus and every 30 seconds while visible. None of these features pages a human or sends email/SMS/push alerts.
- After departure, each side confirms the trip happened; the request completes only when both confirm. If the completion window lapses, the request expires and the app records which side had confirmed, visible to reviewers as "Unconfirmed trips". This is context for a human, not a penalty: someone may have travelled and never reopened the app.
- Users can close their own account from the dashboard. Open requests are withdrawn and accepted seats released, future trips cancelled with in-app notices to affected riders/drivers, the app identity is anonymized, Better Auth identity/credentials/sessions and outstanding magic-link tokens for that email are deleted, and completed history is retained against the anonymous app row. Closure is refused while a trip the user is part of has already departed. The transaction logic and its privacy/capacity invariants are covered by `npm run verify:account-closure`.

## Database

Migrations live in `db/migrations`. `npm run db:migrate` applies unapplied migrations atomically, checks checksums, and uses an advisory lock. It changes only the database specified by `DATABASE_URL`; check that URL before running. Migration 0006 creates the automatic marketplace scope; 0007 indexes normalized area matching; 0008 adds safety reports; 0009 adds account closure; 0010–0012 add trip completion, capacity repair, and unconfirmed-trip evidence; 0013–0015 add in-app notifications; 0016 adds reviewer-only safety-report history; 0017/0019 add the append-only UPDATE/DELETE and TRUNCATE guards; 0018 adds the reviewer trip-dispute notification kind; 0020 indexes read notifications by age for retention cleanup; 0021 adds the optional display-only cost-sharing note; 0022 adds operator-declared area aliases; 0023 adds the support contact and hours on the community; 0024 requires both confirmations for a completed request; 0025 adds the `TRIP_DISPUTE_RESOLVED` notification kind that the reviewer resolution writes; 0026 adds operator-recorded area coordinates and the `area_within_radius` distance function for nearby-area matching; 0027 adds the per-trip meeting detail each participant shares with the other (and the trigger that clears it whenever the seat stops being confirmed); 0028 adds the `MEETING_DETAIL_SHARED` notification kind. Do not run migrations against a shared/production database unless that is the intended operation.

If a migration file is edited after it was applied, the runner refuses to continue (it would silently apply a different schema than the database holds). After verifying the live schema by hand, reconcile only that file with `node ./scripts/migrate.mjs --rebaseline-checksum=<filename>`; it records the new checksum and does not re-run any SQL. Use it deliberately, and prefer a new migration whenever the change is not purely documentary.

Reviewer access is granted with `npm run db:set-reviewer-role -- <email> <MEMBER|OPERATOR|SAFETY_REVIEWER>`.

Mutation idempotency results are retained for 24 hours. `npm run db:prune-idempotency` removes at most 500 expired rows per invocation using row locks that skip work held by another transaction. Schedule it periodically in the intended environment; invoke it repeatedly if a backlog exceeds one batch.

Old in-app notifications are pruned with `npm run db:prune-notifications`. It removes at most 500 rows per invocation, and only notifications the recipient has already **read** and only once older than the retention window (default 90 days; override with `--retention-days=<n>` or `NOTIFICATION_RETENTION_DAYS`). Unread and recent notices are never eligible. Use `--dry-run` to see the eligible count without deleting. Schedule both cleanup commands periodically.

`npm run health-check` prints a deployment readiness report and exits non-zero on a blocking problem, so it can gate a deploy or be run after one. It verifies that every migration file is applied and its checksum matches, that the required tables and columns exist, that the notification enum has every kind the code can write, that the safety-report append-only guards are installed, that an active community scope and a completion policy exist, and that core data invariants hold. It warns (without failing) when no reviewer is promoted, because then the moderation queue is unreachable.

Retention across the rest of the data is not yet applied anywhere. `npm run db:audit-retention` reports how much closed-account, report, dispute, trip and notification data exists at a given age (e.g. `--as-of-days=90`), so the window can be chosen from real volume. It runs inside a read-only transaction and changes nothing; PostgreSQL rejects any write in that transaction, so it cannot delete by mistake.

Two checks assert behaviour against live data rather than page text:

```bash
npm run verify:completion                # schema invariants + REAL classifyOutcome (read-only)
npm run verify:no-show                   # calls the REAL expireStaleTrips (self-cleaning)
npm run verify:dispute                   # calls the REAL resolveTripDispute/listOpenTripDisputes (self-cleaning)
npm run verify:account-closure           # calls the REAL deleteOwnAccount (self-cleaning)
npm run verify:notifications             # calls the REAL listNotifications/read APIs (self-cleaning)
npm run verify:concurrency               # calls the REAL accept/cancel services under parallel load (self-cleaning)
npm run verify:contribution              # calls the REAL createTripOccurrence (self-cleaning)
node scripts/verify-integrity.mjs        # cross-table integrity for disputes/reports/closure (read-only)
node scripts/verify-reviewer-role.mjs    # reviewer-role grant/refuse paths (self-cleaning)
node scripts/verify-area-alias.mjs       # area-alias resolution and matching (self-cleaning)
node scripts/verify-support.mjs          # support-contact read/write and operator gate (self-cleaning)
```

Every script that exercises server behaviour now imports the real service or
function rather than re-implementing its SQL, using `scripts/lib/alias-loader.mjs`
(which maps the `@/*` TypeScript path alias and resolves extensionless relative
imports) via `node --experimental-transform-types --import
./scripts/lib/register.mjs`. Prefer this approach for new checks: a script that
copies the query it is testing verifies the copy and keeps passing after the real
code changes — which is how a broken dispute-resolution path stayed green, how
the closure mirror drifted from the service it claimed to check, and how a real
`40P01` accept deadlock went unseen.

`npm run db:audit-retention` reports aged data volumes read-only, so a retention window can be chosen from real numbers.

`npm run db:prune-history` applies a retention window to the core ride history that previously had none. It deletes at most 500 rows per invocation (override with `--limit=<n>`, max 10000) and only settled history older than the window (default 365 days; `--retention-days=<n>` or `HISTORY_RETENTION_DAYS`). Three rules keep it safe: a trip must be `COMPLETED`/`CANCELLED` (never an open commitment), a trip referenced by any safety report is skipped entirely (evidence outlives the ride), and deletion follows the schema's `RESTRICT` foreign keys (notifications → evidence → disputes → requests → trips). `commute_templates` is never touched — a template is a reusable definition, not history. Use `--dry-run` to preview; it always prints what it declined to delete and why.

`npm run db:maintenance` runs all three cleanup commands (notifications, idempotency, history) in one invocation so an environment schedules a single job, and accepts `--dry-run` to preview every step. It exits non-zero if any step failed. The app schedules none of this itself — configure a periodic job in each environment.

## Route-corridor matching (the map/pin model)

The product requirement: a driver going **Muridke → Model Town Lahore** should match a rider going **Rana Town → MAO College**, because the rider's leg lies along the driver's route — regardless of how far apart the names are and with no fixed radius. `ROUTE_MATCHING_PLAN.md` has the design; `src/domain/geo.ts` has the logic.

A leg **A→B** matches a route **P→Q** when all four hold:

1. both A and B are within `lateralToleranceMeters` of the polyline (how far *sideways* off the road);
2. `along(A) < along(B)` — the rider boards before they alight. **This is the rule a radius cannot express**, and the one that rejects a rider travelling the opposite way;
3. both fall inside the route's own extent (not before P or past Q);
4. A and B are distinct points.

Distance *along* the route is measured by projecting each endpoint onto the nearest segment and accumulating real segment lengths, so it is distance travelled on the road rather than a straight line. Search uses SQL for the cheap indexed filters (date, time window, seats, blocks) and applies the geometry in TypeScript on that small candidate set, ranking by the fraction of the driver's route the rider is on board for.

**Nothing that worked before changed.** Every geometry column is nullable; passing no map points uses the area/alias matching exactly as before, and a trip with no stored route falls back to it. A stored route is validated when read — one malformed point discards the whole route, because projecting onto a partly-broken line yields a confident match on a road that does not exist.

**What is not yet real:** the geometry is currently synthetic (a hand-made corridor in tests), not from a routing provider, so "follows real navigation" is not yet true — see `ROUTE_MATCHING_PLAN.md` §6.2 for the provider choice. There is no map UI and no live tracking yet.

## Profiles, phone and vehicle (ride-hailing Phase 1a)

`GET /api/profile` returns your own profile; `PATCH /api/profile` updates it (`displayName`, `phone`, and for a driver a `vehicle` object — send `vehicle: null` to remove it). `driver_vehicles` holds one vehicle per driver, enforced by a unique index. The dashboard exposes this under **Your profile**, where the vehicle fields appear only in Driver mode.

Who may see someone else's phone and vehicle is the load-bearing rule, and it is the same one the meeting detail uses:

- `GET /api/rides/{requestId}/counterpart` returns the other participant's name, phone, and vehicle **only** when the caller is a participant on that request **and** the request is `ACCEPTED`. Otherwise it returns `{ "identity": null }`.
- It returns `null` rather than `404` deliberately: a distinct status would tell a stranger whether a given request exists and carries a phone number.
- A changed `phone` clears `phone_verified_at`, so a number cannot inherit an earlier number's verification.

The phone is stored as digits with an optional leading `+`; local (`0300 1234567`) and international (`+92 300 1234567`) forms are both accepted. **SMS verification is not implemented** — it needs a provider and a budget — so the UI shows the number as unverified rather than implying it was checked.

## Ratings (ride-hailing Phase 1b)

After a trip is `COMPLETED`, either participant rates the other 1–5 with an optional comment.

- `POST /api/rides/{requestId}/rating` with `{ "score": 1..5, "comment": "…" }`. There is **no `PUT`/`PATCH`/`DELETE`** on purpose: a rating cannot be changed or withdrawn once submitted, and the database refuses both regardless of caller.
- `GET /api/ratings` returns `{ ratings, authoredRequestIds }` — the ratings written *about* you, and the request ids *you* have rated. The second is what tells the dashboard a completed trip still needs a rating; deriving it from the first was a bug, because a rating you write appears in the recipient's list.
- The counterpart card shows an average only once at least three ratings exist (`MIN_RATINGS_FOR_AVERAGE`); below that it says how many there are and shows no score, because one five-star rating is not a reputation.

**Nothing acts on a rating automatically** — no suspension, warning or de-ranking. That is a fairness decision, recorded as the owner's to make (`RIDE_HAILING_ROADMAP.md` §4), not a default.

Immutability is enforced by a trigger with three distinct cases (migration `0031`): an `UPDATE` is always refused; a nested delete — a ride being removed by `db:prune-history` — is allowed; and an explicit erasure transaction sets `SET LOCAL app.allow_rating_erasure = 'on'`, which account closure does so a closed person's ratings are erased rather than left naming a tombstone. Only that flag may delete a rating directly, so every such place is findable by search.

## Meeting details (exchanging the exact pickup)

Areas are deliberately approximate, so once a driver accepts a seat either participant can add a **meeting detail** — an exact pickup point, a landmark, or a contact number — at `PUT /api/rides/{requestId}/meeting-detail` with `{ "detail": "…" }` (a blank value withdraws it). Each participant's text lives in its own column (`driver_meeting_detail` / `rider_meeting_detail`), so neither can rewrite the other's.

The access rule is the point of the feature, and it is enforced in the database, not only the UI:

- A detail is readable and writable **only while the request is `ACCEPTED`**. The read query masks both columns to `NULL` at any other status, so a pending or declined request reveals nothing even if a row somehow carried text.
- A trigger clears both columns the moment a request leaves `ACCEPTED` — driver cancellation, rider cancellation, decline, expiry sweep, account closure, or a reviewer dispute decision. One rule, not six call sites that each have to remember.
- `npm run health-check` asserts the invariant directly (`no meeting detail is retained on a non-accepted request`), so a dropped trigger is a deployment failure rather than a quiet leak.
- The notification that tells the other participant a detail was shared deliberately carries **no** detail text: inbox rows are stored and polled broadly, and a phone number there would be readable well beyond the ride.

The values are **not** encrypted at rest. The threat this addresses is other *users*, not the database operator, who can read any table; encrypting with an application-held key would imply a guarantee this design does not make.

To review reports and disputes, promote an account with the bundled command after it has signed in once:

```bash
npm run db:set-reviewer-role -- reviewer@example.com SAFETY_REVIEWER
```

Use `OPERATOR` for the same access, or `MEMBER` to remove it. The command only promotes an existing **active** account and only changes its membership role; a closed account cannot regain access. There is no UI for granting this role, by design: it should be a deliberate operator action, not something a user can self-assign. If you prefer SQL, the equivalent is `UPDATE community_memberships SET role = 'SAFETY_REVIEWER', updated_at = now() WHERE user_id = (SELECT u.id FROM users u WHERE u.auth_subject = (SELECT au.id FROM "user" au WHERE lower(au.email) = lower('reviewer@example.com')) AND u.status = 'ACTIVE');`. Note the `"user"` table's primary key is `id`; `userId` exists only on `account`/`session` as a foreign key.

## Readiness limits

This implementation supports local product-flow testing. It does not verify identity, driving eligibility, vehicle condition, or user trust; it does not provide emergency response or trip monitoring. In-app notices do not guarantee that a reviewer is online or watching the queue; no email/SMS/push alerts or paging are configured.

Not implemented: no-show *policy*. Unconfirmed completions are recorded and shown to reviewers, but nothing acts on them — there is no threshold, warning, suspension, or appeal path, so the data must currently be read as context during a human review rather than as a determination. Trip disputes have a human review path but equally carry no automatic consequence. In-app notifications are periodic rather than real-time, and external alert channels are not configured.

Before facilitating real rides, complete a staffed support route, a retention schedule for closed accounts and reports, cancellation/no-show/cost-sharing terms, incident response, and applicable local review. See repository-level `MVP_SPEC.md` and `SAFETY_PRIVACY.md`. An operator can publish a support contact and hours in the app (`/api/support`, shown on the dashboard), but publishing text is not the same as staffing it: someone must still answer.
