# Decisions and Evidence Log

Keep observed behavior separate from interpretation. Product decisions can follow founder experience; usage data is evidence about how the built flow behaves, not automatic proof of market size or safety.

## Current product decisions

### Open account creation

- **Status:** DECIDED
- **Decision:** Any person can sign up with email verification when authentication is enabled. Do not require a pilot community, invitation, sponsor, or operator approval to create an account.
- **Reason:** The user flow should be directly understandable and testable: signup, choose a starting mode, use dashboard.
- **Implementation detail:** Internal `communities`/membership schema currently supplies a shared marketplace database scope. It is assigned automatically and must not appear as user-facing community enrollment.

### Rider and Driver are switchable modes

- **Status:** DECIDED
- **Decision:** One account can switch between Rider and Driver at any time. Signup selection is only the initial dashboard mode. A user may retain trip/request records created while using either mode.
- **Implementation detail:** Persist the current mode on the account; enforce allowed actions and ownership server-side.

### Dated trips and confirmation

- **Status:** DECIDED
- **Decision:** Drivers publish specific trip dates; riders request a seat on one date. A request is confirmed only after driver acceptance and capacity update.

### Account closure retains an anonymous tombstone

- **Status:** DECIDED
- **Decision:** Closing an account is not a hard delete. The account is deactivated, its display name and auth subject are erased, its membership is released, and its open requests and future trips are cancelled. The row is kept so trips, requests, reports, and idempotency records that reference it remain valid for other participants.
- **Implementation clarification:** Delete the associated Better Auth identity, linked provider credentials, sessions, and outstanding magic-link tokens for the account email as part of the same transaction. Keep only the app's anonymous historical row.
- **Consistency detail:** Serialize closure against mutations initiated by that account. When withdrawing accepted rider requests, lock their parent trips first and release the corresponding reserved seats in the same transaction before cancelling future driver trips.
- **Counterparty update:** Notify affected drivers/riders in-app when account closure withdraws a request or cancels a future trip; notices are written atomically with the closure and do not expose contact details.
- **Reason:** Hard-deleting the user would either break foreign keys or destroy the other party's record of a shared trip. Privacy is satisfied by erasing identifying fields and preventing sign-in, not by removing the row.
- **Consequence:** An operator still has no way to distinguish a closed account from any other participant in historical data, which is intended. The retention window for these tombstones is unresolved.

### Trip completion and capacity settlement

- **Status:** DECIDED
- **Decision:** Completion is user-confirmed and time-bounded. Each side confirms independently (`driver_confirmed_completion`, `rider_confirmed_completion`); the request reaches `COMPLETED` only when both confirm. A request that is never confirmed within `trip_policy.completion_window` is swept to `EXPIRED`.
- **Decision:** Closing a trip settles its capacity. When a trip becomes `COMPLETED` or `CANCELLED`, `seats_reserved` returns to zero, because a closed trip accepts no new requests and any remaining reservation belongs to nobody.
- **Reason:** Without settlement, a finished trip permanently held seats that no request accounted for. The `seats_reserved = accepted requests` invariant is what overbooking protection depends on, so a closed trip violating it makes the safety property unverifiable.
- **Bug found and fixed:** `closeTripIfSettled` and the expiry sweep both closed trips without releasing seats, stranding capacity. Migration `0011` backfills trips already closed by the buggy code.
- **Consequence:** A `DISPUTED` request deliberately keeps its seat reserved: the seat was taken and the outcome is unresolved until a human settles it. This is the one state where reserved capacity legitimately exceeds accepted-and-settled bookings.

### Unconfirmed completion is recorded as evidence, not as a verdict

- **Status:** DECIDED
- **Decision:** When a completion window lapses, record which side had confirmed (`RIDER_UNCONFIRMED`, `DRIVER_UNCONFIRMED`, `NEITHER_CONFIRMED`, `BOTH_CONFIRMED`) in `trip_no_show_evidence`, preserving the flags as they stood at expiry. Show it to staff as context. Attach no automated consequence to it.
- **Reason:** "Did not confirm" is a different fact from "did not travel". Conflating them would penalise people for not opening an app, which is a foreseeable and unfair outcome. Recording the raw signal keeps the option open; acting on it automatically would bake in an assumption the data cannot support.
- **Consequence:** The evidence is currently read-only context for a human. Any no-show *policy* — thresholds, warnings, appeals — is explicitly out of scope and unresolved.

### In-app ride notifications

- **Status:** IMPLEMENTED; external delivery unresolved.
- **Decision:** Persist recipient-scoped notifications transactionally for ride requests, decisions, cancellations, completion confirmation/expiry, disputes, new safety reports, and report status changes. Stable unique event keys make event creation idempotent; recipients can mark one or all entries read.
- **Reason:** State changes visible only after a manual reload are easy to miss. Writing the notification in the same transaction avoids notifications for rolled-back changes and missing entries after committed state transitions.

### Safety report action history

- **Decision:** Store report submission and reviewer status changes as append-only audit events, including actor, time, transition, and internal notes. Restrict event reads to active safety reviewers/operators.
- **Existing records:** Backfill one clearly labeled snapshot of each report's state; do not represent unknown past actions as reconstructed history.
- **Reason:** The report row stores only current status and notes, so later updates otherwise erase prior review context and accountability.
- **Limitations:** The client polls while visible and refreshes on focus; this is not real-time. Safety notices are in-app only; there is no email/SMS/push delivery, page/on-call behavior, or response-time guarantee. Notification retention is now bounded for old read notices (`npm run db:prune-notifications`, default 90 days) but is not scheduled by the app and does not cover unread notices.

### Trip dispute review is a human decision, not an automatic penalty

- **Status:** IMPLEMENTED; policy consequences unresolved.
- **Decision:** Either participant can report that an accepted trip did not happen as agreed. The request moves to `DISPUTED`, active reviewers are notified in-app, and a reviewer records only whether the trip happened (`COMPLETED` or `EXPIRED`). Resolving notifies both participants and attaches no automatic consequence to either.
- **Reason:** The app cannot know what happened between two people. Recording the decision and showing it to both sides is honest; inventing a penalty, refund, or reputation effect from a single report would not be.
- **Consequence:** A reviewer could previously not see or act on a dispute at all, so the participant-facing "awaiting operator review" text described something that did not exist. A dispute raised again after a decision re-opens it for review rather than being silently absorbed.

### Reviewer access is granted out-of-band

- **Status:** DECIDED. Command verified by `npm run verify:reviewer-role`.
- **Decision:** Every account is created as a marketplace `MEMBER`. Reviewer/operator access is granted only by running `npm run db:set-reviewer-role -- <email> <MEMBER|OPERATOR|SAFETY_REVIEWER>`, never from the web app.
- **Reason:** With open signup, an in-app promotion path would let any account grant itself access to other people's reports and disputes. A separate command keeps that a deliberate operator action. Only active accounts can be promoted, so a closed account cannot regain reviewer rights.
- **Consequence:** A deployment that never runs the command has no reviewer and no one can see the moderation queue — an operational step, not a bug. **The command was itself broken until it was tested**: its lookup selected `"user"."userId"`, but that table's primary key is `id` (`userId` exists only on `account`/`session`), so every run failed and no reviewer could be promoted. Verified and fixed; the README's equivalent SQL snippet had the same mistake.

### COMPLETED means both sides confirmed, and the database now enforces it

- **Status:** IMPLEMENTED (migration 0024). Found by extending `verify-completion` after a health check.
- **Decision:** A `COMPLETED` request must carry both `rider_confirmed_completion` and `driver_confirmed_completion`, enforced by a database constraint rather than only by application code.
- **Reason:** The intended rule was that a request completes only when both sides confirm, but the constraint only required `accepted_at IS NOT NULL`, so a one-sided `COMPLETED` was storable — and two such rows existed. Application code even claimed the database enforced it. A one-sided completion is exactly the fact a dispute turns on: it asserts the trip happened with the agreement of someone who never gave it.
- **Consequence:** The two violating rows were corrected to `EXPIRED` with `completed_at` cleared — the state a one-sided confirmation should have reached — rather than inventing a confirmation nobody gave. A one-sided `COMPLETED` is now rejected by the database and a genuine one accepted, both verified directly.

### Readiness is checked, not assumed

- **Status:** IMPLEMENTED as `npm run health-check`; not a monitoring or recovery system.
- **Decision:** Provide a command that verifies a deployment can operate — migrations applied and checksum-matched, required tables/columns, every notification kind the code writes, the append-only guards, an active scope, a completion policy, and four data invariants — and exits non-zero on a blocking problem.
- **Reason:** A connected database is not the same as a working app. Two failures found in this project were exactly this shape: `set-reviewer-role` was broken so no reviewer could exist, and a dropped guard would silently remove append-only protection. Both are invisible from a health endpoint that only checks connectivity.
- **Consequence:** A missing reviewer is a warning rather than a failure — a fresh development database legitimately has none — but on a deployment with reports arriving it means the moderation queue is unreachable, so it is reported. This does not monitor, alert, or recover; it only answers "is this deployment ready" when run.

### Nearby areas match by declared distance, not by a guess about the name

- **Status:** IMPLEMENTED (migration 0026). **This supersedes the earlier "never matched by geography" position for areas an operator has explicitly placed.**
- **Observation:** Exact/alue matching plus operator aliases still left the common case broken: a rider searching “Liberty Market” found nothing from a driver leaving “Gulberg III” a kilometre away, because the two names share no text. The alias table can bridge that only if an operator creates one alias per spelling pair, which does not scale and still fails for any pair nobody thought to declare.
- **Why this is not the guess the earlier decision rejected:** The earlier rule rejected *inferring* proximity from a name (e.g. assuming “Gulberg III” is near “Gulberg”). That would silently widen matching in ways a user cannot see and cannot correct — and a wrong guess pairs strangers who think they agreed on a meeting point. This feature infers nothing from text: an operator records a coordinate for an area, and only two **placed** areas are ever compared. An unplaced area keeps the old behaviour exactly.
- **Decision:** `area_coordinates` stores one coordinate per normalized area per community, maintained only by `OPERATOR`/`SAFETY_REVIEWER` accounts at `/moderation/reports`. Search matches an origin or destination side when the resolved names are equal **or** when both sides have coordinates within a server-configured radius (`AREA_RADIUS_METERS`, default 2 km; `0` disables it). The radius is server-controlled, never read from the request, so a client cannot widen matching to every trip. Exact/alias equality is evaluated first and is unaffected.
- **Reason for the pairing rule:** requiring no coordinate is a safe default — it can only *fail to match*, never mismatch. The unsafe direction (matching two places that are actually far apart) is bounded by the radius the operator chooses, and is reviewable, because every coordinate is operator-entered and visible in the queue.
- **Consequence:** Area matching is no longer purely textual. A deployment that records no coordinates behaves exactly as before, so this is additive. The radius is a single constant per deployment, not per-area or per-search.
- **Limitations:** The distance is a great-circle (haversine) calculation on a sphere — accurate to well under a percent at city scale, but it does not know about roads, barriers, or travel time: two areas 1 km apart across a river match as readily as two on the same street. Coordinates are operator-entered and are not geocoded from the name, so this does not help until someone places the areas that matter. The radius is not per-city tuned.

### Area equivalence is declared, never guessed

- **Status:** IMPLEMENTED (migration 0022). The "not matched by geography" clause is superseded by the distance rule above, which applies only to operator-placed areas.
- **Decision:** An operator may declare that one area name is equivalent to another via `area_aliases`; both spellings then match each other in search. The app never infers that two different names are "nearby".
- **Reason:** Text normalization already handled case and spacing, but a rider searching "Gulberg" still missed a driver who wrote "Gulberg III". Guessing proximity from names would silently widen matching in ways users cannot see or correct, and a wrong guess pairs strangers who think they agreed on a meeting area. An explicit, operator-visible alias keeps equivalence auditable.
- **Consequence:** Aliases are managed through the moderation page and are reviewer-only. The database rejects a self-alias and a duplicate alias for the same area, and the service rejects cycles so resolution stays deterministic.

### Support contact is published, not staffed

- **Status:** IMPLEMENTED (migration 0023); staffing remains unresolved.
- **Decision:** An operator can store a support contact and hours on the community; every active member can read it and it is shown on the dashboard. Writes are operator-only.
- **Reason:** A report with no way to reach a person is a dead end. Making the contact visible in the app is the smallest honest step: it does not claim a response time and does not pretend the app monitors anything.
- **Consequence:** The text is display-only. The app still sends no alert and provides no emergency response, so publishing a contact is not the same as someone answering it — that is a staffing decision, not a code change.

### Seat overbooking is guarded twice, deliberately

- **Status:** VERIFIED by `npm run verify:concurrency`.
- **Decision:** Keep both the application capacity guard (a conditional `UPDATE ... WHERE seats_reserved < seat_capacity`) and the database `CHECK (seats_reserved <= seat_capacity)`.
- **Reason:** A negative control that removes the application guard shows the database constraint still refuses to overbook. Either layer alone would be a single point of failure; the conditional update returns a clean `NO_SEATS_AVAILABLE` to the losing request, while the constraint is the backstop if that guard is ever removed or bypassed.
- **Consequence:** Overbooking requires both layers to fail. The test is proven non-vacuous, so it will catch a future regression rather than passing silently.

### Cost sharing is a note, not a payment

- **Status:** IMPLEMENTED (display-only); contribution terms and any payment handling are unresolved.
- **Decision:** A driver may attach one short free-text note (≤160 characters) to a commute. It is copied to each trip occurrence at publish time, so editing the commute later does not rewrite what an already published trip advertised.
- **Reason:** Riders commonly contribute to fuel, and leaving it unstated pushes it into an unlogged side conversation. A free-text note records the expectation without introducing an amount, a price, an escrow, or a refund path the app cannot honour. Copying at publish time keeps a trip's advertised terms stable.
- **Consequence:** The app parses no amount and moves no money; the note must not be presented as a price or a charge. Real contribution terms, dispute handling for money, and any payment mechanism remain out of scope.

### Account closure is verified, not assumed

- **Status:** VERIFIED against the live schema; browser flow still unverified.
- **Decision:** Cover closure with `npm run verify:account-closure`, which exercises the real guards and asserts the privacy, capacity, and history invariants rather than only that the status column changed.
- **Reason:** Closure is the most destructive flow and touches other participants' rows. A status flip that leaked a reserved seat or left a membership `ACTIVE` would be a silent correctness and privacy defect that the UI would not reveal. Writing the check caught a fixture date constraint bug and proved the seat release and cancellation paths.
- **Consequence:** The transaction logic is now evidence-backed. Scheduling the closed-account tombstone retention window is still an open policy decision.

### Notification retention deletes only what was read

- **Status:** DECIDED; window and scheduling are environment choices.
- **Decision:** `npm run db:prune-notifications` deletes at most 500 notifications per run, and only rows the recipient has already read and only once older than the retention window (default 90 days). Unread notices are never deleted. `--dry-run` previews the eligible count.
- **Reason:** The inbox otherwise grows forever. Deleting unread notices would destroy information a user has not seen — including safety outcomes — which is not a retention choice but data loss. Restricting deletion to read rows means the recipient has already consumed the notice.
- **Consequence:** The command is bounded and needs periodic scheduling per environment; it does not cover other tables (reports, trips, tombstones), whose retention remains unresolved.

### Migration checksum reconciliation is explicit and logged

- **Status:** DECIDED.
- **Decision:** If a migration file is edited after it was applied, the runner refuses to continue. The only way past it is `--rebaseline-checksum=<filename>`, which records the file's current checksum without re-running SQL, after the applied schema has been verified by hand.
- **Reason:** Silently accepting a changed migration means a database whose schema no longer matches its history and no record of the divergence. Making the override explicit keeps that visible. The reverse — a newly added guard that was never applied — ships as a new migration (`0019`) instead of editing the applied one.


### Real-world readiness

- **Status:** REQUIRED BEFORE LIVE TRIPS
- **Decision:** Open signup does not remove the need for a support contact, privacy/retention rules, cancellation terms, report/block handling, incident response, and any applicable local review before real ride facilitation.

### Reviewer dispute resolution was broken end to end

- **Status:** IMPLEMENTED and FIXED; found by browser verification, not by the test that claimed to cover it.
- **Observation:** In a real browser, a reviewer could open `/moderation/reports`, see an open dispute with full context, and click "Trip happened" — which returned `404 RIDE_NOT_FOUND` and recorded nothing. Three independent defects sat on the same path: (1) `resolveTripDispute` read `dispute.request_id` while the query aliases the column `ride_request_id`, so the request lookup never matched; (2) once that was fixed, the write to `COMPLETED` omitted the confirmation flags that migration `0024`'s both-confirmations CHECK requires; (3) the resolution's `TRIP_DISPUTE_RESOLVED` inbox notice wrote an enum value that no migration ever added, failing the transaction at the final step.
- **Interpretation:** The path was untested, not unlucky. `verify:dispute` mirrored its own copy of the resolution SQL and only ever resolved `TRIP_NOT_COMPLETED` → `EXPIRED`; it invoked `TRIP_CONFIRMED` once, against a request it had reset to `ACCEPTED`, and asserted only that it was refused — so the `COMPLETED` branch, the notification, and the enum were never executed. A test that re-implements the code under test verifies the copy, not the code.
- **Decision/action:** Fix the column read and its type; have the reviewer's `TRIP_CONFIRMED` decision set both confirmation flags (a reviewer is the authority on whether the trip happened for the parties who did not confirm, which is why the dispute exists); add migration `0025` for the missing notification kind; make `verify:dispute` mirror the current SQL exactly and exercise `TRIP_CONFIRMED` → `COMPLETED` against a real fixture (14 checks); make `health-check` derive notification kinds from the server source instead of a hand-maintained list that had silently omitted the same kind.
- **Limitations:** The browser run used seeded accounts and a fixture trip deliberately set to have departed. It exercised both resolution outcomes and the participant notices; it did not exercise a reviewer resolving while the reported party is simultaneously mutating the trip (covered by the shared lock ordering, not by this run).

### A list that says "none" before it has loaded is a false statement

- **Status:** FIXED and verified in a browser.
- **Observation:** With a slow API round-trip, every dashboard list (requests, activity, reports, published trips, commutes, inbox) rendered its empty-state sentence — "No requests yet.", "No trips or requests yet." — during the first load. A user with existing data would reasonably conclude it was gone.
- **Interpretation:** An empty list and an unloaded list are different facts, and the UI stated one when it meant the other. The correct default for "we do not know yet" is a loading state, not a confident zero.
- **Decision/action:** Gate the empty-state text on a `dashboardLoaded` (and `notificationsLoaded`) flag that is set when the first load settles, including on failure; show "Loading…" until then. Verified by sampling the DOM across a fresh load: it shows "Loading…" then the real data.
- **Limitations:** This is a presentation fix for a slow network, not a performance fix. The underlying round-trips are still seconds against the remote development database.

### A test that re-implements the code verifies the copy, not the code

- **Status:** FIXED for `verify:dispute`; the pattern was present in several scripts.
- **Observation:** The trip-dispute resolution path was broken three ways at once (a wrong column read, a missing confirmation flag, an unmigrated notification kind) while `npm run verify:dispute` stayed green — because the script carried its own copy of the production SQL ("Mirrors resolveTripDispute … SQL only") and only ever exercised the `EXPIRED` branch. Every `verify-*.mjs` script did the same thing: it re-implemented the query or guard it claimed to check.
- **Interpretation:** A mirror encodes what the author believed the code did at the time they wrote the mirror. It cannot observe a later change to the real code, and when the two disagree the test passes on the stale belief. This is the same failure mode as the earlier `set-reviewer-role` bug: a check that looked like coverage while the thing it named was broken.
- **Decision:** Where a service is importable, the verification script now imports and calls the real function instead of copying its SQL. `scripts/lib/alias-loader.mjs` maps the `@/*` TypeScript path alias so plain `.mjs` scripts can `import("@/server/users/reports")`, run with `node --experimental-transform-types` (strip-only mode rejects the parameter properties in `errors.ts`). `verify:dispute` was converted first, as the path that had already proved the risk: it now calls `resolveTripDispute` and `listOpenTripDisputes` directly (16 checks), and a negative control that removes the production fix fails the run.
- **Consequence:** All six scripts that exercised server behaviour now import the real code (`verify:dispute`, `verify:account-closure`, `verify:no-show`, `verify:notifications`, `verify:concurrency`, `verify:contribution`, `verify:completion` — seven commands, six originally mirrored). Every conversion found either a defect, a drifted fixture, or a vacuous check. `verify:completion` no longer re-derives the no-show classifier with its own `CASE`; it calls `classifyOutcome`, and it now inserts a known evidence row so the classifier check is not vacuous on an empty table. Fixtures are committed before a real service call, because the services open their own transactions — holding a fixture transaction open across a service call deadlocks on the same rows.
- **Limitations:** `--experimental-transform-types` is a Node experimental flag; a future Node release could change it. The loader maps only the `@/*` alias and does not attempt to run Next.js-only modules (`next/headers`), so HTTP-layer behaviour still needs a browser or an integration harness.

### A verification fixture must be owned, not borrowed

- **Status:** FIXED in `verify-dispute` and `verify-support`.
- **Observation:** `verify-support` selected the first four ACTIVE accounts and, when none had `role = 'MEMBER'`, fell back to `accounts.rows[0]` while labelling it MEMBER. Once a real OPERATOR account existed, the "a plain member cannot write support settings" assertion ran against that operator and failed (`role=MEMBER` in the detail was a lie about what was tested). `verify-dispute`, once converted to call the real service, borrowed the first two ACTIVE accounts as driver/rider and made the same assumption; one was the promoted reviewer, so its "non-reviewer is refused" check proved nothing.
- **Interpretation:** A test that reads its fixture from whatever happens to be in the database encodes an assumption about that database. The assumption was true on a fresh development database and false as soon as the tests themselves created privileged accounts — the failure looked like a broken authorization gate but was a mislabelled fixture. Ordering and coexistence between tests are real dependencies whether or not they are acknowledged.
- **Decision:** Verification scripts create the exact accounts they need, with explicit roles, and delete them afterwards; they do not borrow rows whose properties they only assume. Where a required role is absent, the script fails with a clear message instead of substituting a different row.
- **Consequence:** Both scripts are now independent of pre-existing database state. A `verify-*` run can no longer be made to pass or fail by data another run left behind.
- **Limitations:** Fixtures still share the one marketplace community, so a future script must namespace its markers (these use `vd-`/`ac-` prefixes) to avoid colliding with another.

### Concurrent accepts deadlocked on a shared account lock

- **Status:** FIXED; regression covered by `npm run verify:concurrency`.
- **Observation:** Four riders racing for one seat on the same trip produced three `40P01 deadlock detected` errors from Postgres, not the expected `NO_SEATS_AVAILABLE`. Sampling `pg_locks` during the hang showed every transaction holding a row lock in `idempotency_records` and waiting on the same advisory lock. The behaviour was reproducible: three of four concurrent accepts failed.
- **Interpretation:** The app's lock order was not uniform. `acceptRideRequest` inserted its idempotency row first and only then took the driver's `account-action` advisory lock, while other paths take that account lock first. Two different orders over the same pair of lock types (a table row and an advisory lock) is a cycle waiting for enough concurrency to appear — two accepts happened to resolve, four did not. This was invisible to the mirrored test because the mirror re-implemented only the capacity guard and omitted both the advisory lock and the idempotency insert.
- **Decision:** Acquire the acting account's advisory lock at the very start of the transaction, before `withIdempotency` writes the idempotency row, so every concurrent operation for one account shares a single order: advisory locks, then rows. Also move the driver/rider pair lock ahead of the trip row lock in `acceptRideRequest` and `requestSeat`, so an advisory lock is never taken while a row lock is held.
- **Consequence:** Vertex-of-contention behaviour is now deterministic: one accept wins, the rest receive `NO_SEATS_AVAILABLE` as a normal domain outcome. `verify:concurrency` asserts the absence of `40P01` by name, and a negative control (reverting the lock placement) fails on exactly that assertion, so a reintroduced cycle fails loudly rather than occasionally.
- **Limitations:** The guarantee is per-account and per-trip. A workload that contends across many accounts and many trips at once (real production load) has not been exercised; the fix removes the known cycle, it does not claim a proof that no other order exists.

### Retention bounds the mechanism, not the obligation

- **Status:** IMPLEMENTED as `db:prune-history` + `db:maintenance`; policy windows for tombstones and reports remain undecided.
- **Observation:** `db:prune-notifications` and `db:prune-idempotency` bounded their tables, but the core ride tables (`trip_occurrences`, `ride_requests`, `trip_no_show_evidence`, `trip_disputes`) grew without limit — the audit command could measure that growth but nothing could act on it.
- **Decision:** Provide a bounded, dry-runnable prune for settled ride history, guarded by three rules enforced in the query rather than in a comment: only settled states are eligible; a trip referenced by any safety report is skipped entirely; deletion follows the schema's `RESTRICT` foreign keys in dependency order. `commute_templates` is never deleted — it is a reusable definition, not history.
- **Reason for protecting report-linked trips:** a safety report is the record that an incident was raised. Deleting the trip underneath it would either destroy that record or leave it pointing at nothing. Evidence outlives the ride. Deciding the retention of a *report* is a legal and ethical question, not a storage question, so the tool grows the safe default (keep) and reports what it therefore declined to delete.
- **Reason for `--dry-run` on every step:** a scheduled preview across all cleanups must not delete on one of them because that script ignored the flag. `db:prune-idempotency` did exactly that until this change; it now counts and rolls back.
- **Consequence:** The ride tables are now bounded by a mechanism an operator can run and schedule. The app still schedules nothing — that is a per-environment operational choice, stated plainly rather than implied. Closed-account tombstones and safety reports have no applied window, by decision, and the command says so in its output.
- **Limitations:** These are deletion commands. They are bounded and each step is individually reported, but nothing monitors them: if a scheduled job stops running, the only signal is the audit command showing growth. There is no automated verification that a deployment actually schedules `db:maintenance`.

### The meeting detail is bounded by the seat, not by the screen

- **Status:** IMPLEMENTED (migrations `0027`, `0028`).
- **Observation:** The product required precise pickup/contact information to be shareable "only when needed for an accepted trip and with the parties involved", but there was nowhere to put it. Areas are deliberately approximate, so two people who had agreed a ride still could not say where exactly to meet — the flow stopped one step short of an actual ride.
- **Decision:** Add a per-participant meeting detail on `ride_requests` (`driver_meeting_detail`, `rider_meeting_detail`), writable only by that participant, readable by the other, and available **only while the request is `ACCEPTED`**. Withdrawal is clearing the field.
- **Why both a masked read and a clearing trigger:** Hiding a control in the UI is not access control. The read query masks both columns to `NULL` at any non-accepted status, so a row that somehow carries text still reveals nothing. Separately, a `BEFORE INSERT OR UPDATE` trigger nulls both columns whenever a request leaves `ACCEPTED`.
- **Why a trigger rather than a CHECK constraint:** A request leaves `ACCEPTED` from six distinct statements — driver cancels the trip, rider cancels the request, decline, the expiry sweep, account closure, and reviewer dispute resolution. A `CHECK` would have rejected all six until each was individually edited, and would have silently begun rejecting any seventh added later. The trigger states the rule once and cannot be forgotten by a new call site, which is the failure mode the codebase has already been bitten by twice (a duplicated expiry sweep, and a mirrored test).
- **Consequence:** A phone number written for a confirmed ride is gone from the database the instant that ride stops being confirmed, by whichever path. `health-check` asserts the same invariant (`no meeting detail is retained on a non-accepted request`), so losing the trigger fails the deployment gate rather than leaking quietly. The notifying inbox row carries no detail text, because inbox rows are retained and polled more broadly than the ride.
- **Deliberately not done — encryption at rest.** The threat this addresses is other users, not the database operator, who can read every table regardless. Encrypting with a key the application itself holds would invite a stronger reading of the guarantee than the design makes. This is stated in the migration, the README and the spec rather than left implied.
- **Deliberately not done — message-level reporting.** The detail is free text with no per-message report path; a participant can withdraw their own text and can file the existing trip-linked report. Building a report action on a field with no reviewer consequence would be pretend safety. If contact exchange specifically needs discouraging, that is a policy decision.
- **Limitations:** The detail is free text, so it can carry anything up to 500 characters and is not moderated or scanned. Nothing prevents a participant from putting a phone number there on an accepted ride — that is the intended function — and nothing warns them it will be deleted when the ride is cancelled. Length is capped so this cannot become an unbounded message thread.
- **Timing, and why it is right:** A trip that has departed but is not yet confirmed stays `ACCEPTED` (the `awaitingCompletion` window), so the detail remains visible for the whole ride and the confirmation window that follows — precisely when two people standing a street apart need it. It disappears only when the request becomes `COMPLETED`, `CANCELLED`, or `EXPIRED`, i.e. when the ride is over or called off. The deliberate consequence is that there is **no post-ride record** of where the two met: after completion the detail is gone, so a dispute about a meeting point cannot be reconstructed from it. That is the intended reading of "only when needed for an accepted trip" — the trip report and the dispute mechanism are the places a problem is recorded, not this field. Recorded here because it is a real property of the design, not an oversight.
- **Verified in a browser, both directions:** signing in as each seeded participant showed the *other's* text (driver saw the rider's note, rider saw the driver's), each side's own text echoed with a withdraw control, zero console errors and zero failed requests.

### Scope reversal: expanding from carpooling toward on-demand ride-hailing

- **Status:** DECIDED by the owner, this session. Supersedes the deferral in `plan.md` line 37 and `MVP_SPEC.md` line 42. Phase 1 started; later phases planned, not started.
- **Observation:** The owner asked for an app "similar to Careem, Uber, InDrive, Yango". The committed scope explicitly deferred exactly the features that define those products: payments, location tracking, route optimization, ratings, identity documents, native apps. What exists is a **scheduled carpooling** marketplace (driver publishes a dated commute, rider searches it, no money moves), which is a different core loop from **on-demand ride-hailing** (rider requests now, nearest driver is dispatched, metered fare, live tracking, ratings).
- **Decision:** Expand toward ride-hailing in independently shippable phases, described in `RIDE_HAILING_ROADMAP.md`. Phase 1 (profile, ratings, reliability visibility) needs no external dependency and has begun. The carpooling flow is **kept**, not replaced: on-demand trips are added alongside scheduled ones. Later phases are gated on business decisions, not on code.
- **What carries over rather than being thrown away:** identity and mode switching; blocking, trip-linked reports and append-only reviewer history; the notification inbox; the concurrency discipline (one lock order, guarded capacity writes, idempotency everywhere — including a deadlock already found and fixed); area aliases and coordinate distance matching; meeting details bounded by an accepted seat; retention, health-check and the verification harness. The existing app is a stronger foundation for hailing than a greenfield start would be, because the accountability and concurrency layers are already correct.
- **What is genuinely absent, and hard:** no money at all (no fare model, provider, ledger or payouts); no live location; no real-time transport (the inbox is *polled every 30 seconds*, while hailing needs sub-second updates and therefore a deployment that permits long-lived connections); no geospatial index; no ratings or vehicle identity; no on-demand trip kind; no routing/ETA; no mobile client. The roadmap states plainly that Phase 5 (money, mobile, real-time) is where the product actually becomes Careem-class, and that Phases 1–4 make the existing web app more trustworthy without making it a hailing app.
- **Deliberate limits on what was done without asking:** no fare or fee was invented, no payment or SMS provider was integrated, no automatic suspension or penalty on the basis of ratings or cancellations was added (visibility only), no location history will be stored without a chosen retention window, and the carpooling flow was not deleted. Those are business, legal and fairness decisions, listed in the roadmap as blocking specific phases.
- **Consequence:** The repository now has two scope documents that disagree by design — `plan.md`/`MVP_SPEC.md` describe the shipped carpooling scope, `RIDE_HAILING_ROADMAP.md` describes the intended hailing scope — and the tracker will say which phases are built. Anyone reading must know which product a given section describes.
- **Limitations:** Regulation of commercial passenger transport in Pakistan is provincial and is not addressed here; it should gate real paying passengers. The gap between a phased web roadmap and a shipping ride-hailing product is large and is stated rather than understated.

### Ratings are a record, not a negotiation

- **Status:** IMPLEMENTED (migrations `0030`, `0031`), verified against the live database and in a browser.
- **Observation:** Phase 1 of the hailing roadmap needs a reputation signal — a rider is deciding whether to get into a stranger's car, and a driver whether to accept a stranger.
- **Decision:** Both sides rate 1–5 with an optional comment after a `COMPLETED` trip. Four rules, chosen to keep the signal trustworthy: only a completed trip is rateable; one rating per side per request (unique index); a rating is immutable (no edit or withdraw); and nothing in the app acts on a rating automatically.
- **Why immutability is strict, including "no withdraw":** if a rating can be retracted, the rational move is to rate low and then withdraw when the other side retaliates. Immutability also makes the aggregate a record of what was said, which is the only basis on which it can honestly be shown to strangers. The cost is that a mistaken or malicious rating cannot be corrected by the author; the safety-report path is where a contested rating is raised, and a human reviews it.
- **Why an average is withheld below three ratings:** one five-star rating displayed as `5.0` next to a name asserts a reputation from a single opinion. Below the threshold the UI says how many ratings exist and shows no score.
- **Why nothing acts on a rating:** suspension, de-ranking or warnings driven by a rating or a cancellation pattern is a fairness decision with real consequences for someone's livelihood. It is recorded as the owner's decision (roadmap §4) rather than implemented by default. The data is stored so the decision can later be made from evidence.
- **The bug this created, and what it taught:** the first trigger blocked every direct delete, which correctly stops a user withdrawing a rating and incorrectly stops account closure — the read path joins `users` for the author's name, so a surviving rating would keep a name attached to a tombstone meant to carry none. `0031` splits the rule three ways (UPDATE always refused; nested delete allowed for retention; an explicit `app.allow_rating_erasure` flag for erasure) rather than one blanket condition, because the three cases have genuinely different answers. A heuristic (`pg_trigger_depth()`) covered only two of them, and the third was found by running the flow rather than by reading the migration.
- **Consequence:** Ratings are countable and immutable; closure and retention still work; no automatic penalty exists. `health-check` asserts three invariants — no rating on a non-completed request, no self-rating, and no rating referencing a closed account.
- **Limitations:** Ratings are freely writable by any participant of a completed trip, so a determined pair could trade inflated ratings; nothing detects that, and the aggregate is not weighted for it. Comments are unmoderated free text. A rating is tied to a ride, so a rider who never completes a trip never gains or loses a rating — which is honest, but means an inactive account has no reputation either way.

### Matching is along the route, not within a radius

- **Status:** IMPLEMENTED (migration `0032`, `src/domain/geo.ts`), verified against the live database. Routing provider not yet chosen.
- **Observation:** The owner described the product precisely: a driver going Muridke → Model Town Lahore should match a rider going Rana Town → MAO College, because the rider's leg lies *along* the driver's route — with no fixed radius, paths based on navigation, and live tracking on a map. Area-name matching (plus a 2 km radius) cannot express that. It is wrong in **both** directions: it matches a driver 1.5 km away travelling the *opposite* way, and it misses a driver 30 km along the rider's exact road.
- **Decision:** Store the driver's path and test containment. A rider matches when both of their endpoints lie within a lateral tolerance of the driver's polyline **and** they board before they alight (measured as distance *along* the path) **and** both endpoints fall inside the route's own extent **and** the leg is not degenerate.
- **Why the direction rule is the important one:** it is what a radius can never express, and getting it wrong is the worst failure in the product — matching two people travelling opposite ways and dropping the rider at the wrong end. It is deliberately *not* widenable: the tests assert that a 50 km tolerance still refuses a reversed leg, so no configuration mistake can turn a direction mismatch into a match.
- **Why geometry lives in TypeScript rather than SQL:** projecting a point onto a polyline is a small, testable computation, and it is exactly the kind of code where a subtle error (a reversed route, a transposed latitude, a projection not clamped at the segment ends) produces a plausible wrong answer instead of an error. It is written to be readable and covered by 18 checks. SQL does what it is good at — the indexed, cheap filters — and the geometry runs on the small candidate set afterwards. This also avoids a PostGIS dependency that a managed database may not permit.
- **Why the trip snapshots its route (copy-on-publish):** a commute stays editable. An already-published trip must not silently acquire a new path, because riders matched the route they were shown. This is the same rule the cost-sharing note already follows, and it is enforced in the same INSERT.
- **Why nothing breaks:** every new column is nullable, a trip with no geometry falls back to area matching, and a route is validated on read — a single malformed point discards the whole route, because projecting onto a partly-broken line yields a normal-looking match on a road that does not exist.
- **Consequence:** The matching rule the product needs now exists and is tested, including the owner's own example. **What is not yet real:** the geometry comes from a hand-made corridor, not a routing provider, so "follows real navigation" is currently false. The lateral tolerance is a fixed server constant (~1.5 km) rather than a driver-set detour budget.
- **Limitations:** No map UI, no live tracking, no ETA, no provider. Commutes created before this have no coordinates and keep matching by name. Latitude/longitude ordering cannot be validated by the database (bounds catch the impossible, not the plausible), so a caller passing a swapped pair produces a valid-looking wrong route — the API must therefore validate the request rather than trust the shape.

## Evidence record template

### YYYY-MM-DD — short title

- **Type:** OBSERVED / INFERRED / HYPOTHESIS / UNRESOLVED / DECISION
- **Observation:** What directly happened? Include count and denominator.
- **Interpretation:** What might it mean? Keep uncertainty explicit.
- **Decision/action:** What changes, if anything?
- **Limitations:** Other explanations, selection effects, missing data.

Example:

- **Observed:** 1 of 1 `COMPLETED` trips in the development database had `seats_reserved = 1` while no request held a matching accepted seat.
- **Interpretation:** Trip closure did not settle capacity. Cause confirmed in code (`closeTripIfSettled`, expiry sweep), not inferred from the sample.
- **Status:** OBSERVED and FIXED — invariant now asserted by `web/scripts/verify-completion.mjs`.

- **Observed:** 3 of 8 test users could not find the Rider/Driver switch.
- **Interpretation:** The toggle may be hard to notice.
- **Status:** HYPOTHESIS — needs another usability check after a UI change.
