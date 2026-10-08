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
