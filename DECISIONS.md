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
