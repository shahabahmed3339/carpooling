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

- **Observed:** 3 of 8 test users could not find the Rider/Driver switch.
- **Interpretation:** The toggle may be hard to notice.
- **Status:** HYPOTHESIS — needs another usability check after a UI change.
