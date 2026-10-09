# Product Test Brief

**Status:** Internal product testing. No real rides are implied by a local test account.

## Goal

Verify that an ordinary user can create one account, switch between Rider and Driver, and complete the relevant dated-trip workflows without losing their account data.

## Core user journey

1. User enters their name and email, chooses a starting dashboard, and verifies email.
2. User lands on the selected mode. The dashboard toggle switches between Rider and Driver.
3. In Driver mode, user creates a commute and publishes a specific date.
4. In Rider mode, user finds that dated trip and requests a seat.
5. Driver accepts or declines; rider sees the resulting state and can cancel a pending/accepted request as allowed by the rules.

The same user may act in both roles. A role toggle is a view/action mode, not a different account or separate membership.

## Out of scope for this test

- Selecting or joining a user-facing community or organization.
- Sponsor, operator, or invitation approval during signup.
- Real-world safety claims, identity verification claims, or proof of market demand.
- Payments, live tracking, route optimization, ratings, and citywide promotion.

## Test setup

- Environment: local development, loopback URL, disposable development database.
- Accounts: at least two verified test accounts with distinct emails.
- Data: approximate/sample areas only; no real home addresses or real trip coordination.
- Required schema: all current migrations `0001` through `0024` applied to the disposable local development database before exercising the current app flows.

## Acceptance checks

- New account signup works without an invitation or community choice.
- Signup's Rider/Driver choice sets the initial dashboard only.
- A user can switch modes repeatedly; the choice persists after reload/sign-in.
- The same user's data remains attached to that account across mode switches.
- A driver can publish a dated trip; another account can find/request it.
- The driver can accept/decline, and the rider sees updated status.
- Duplicate mutation requests do not create duplicate trips/requests; simultaneous seat requests do not overbook capacity.
- Unauthorized actions fail at the server even if a client bypasses the UI.

## Real-use gate

Before facilitating actual trips, configure production email and support contact, publish understandable privacy/retention and trip rules, define reporting/blocking and incident response, and obtain any required local legal/insurance review. These are operational readiness requirements, not account signup or community membership requirements.
