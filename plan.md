# Carpool Pakistan — Simple Product and Build Plan

## Product model

Anyone can create an account with email verification. Each account can use either mode:

- **Rider:** search for a dated trip and request a seat.
- **Driver:** add a usual commute, publish a specific trip date, and respond to seat requests.

The same person may switch between Rider and Driver from the dashboard. The selection at signup is only the starting dashboard, not a permanent account type. A request is not a confirmed seat until the driver accepts it.

There is no user-facing community, invitation, sponsor, or operator signup step. “Community” exists in the current database schema as an internal shared marketplace scope; users do not select or manage it. It must not be shown as a prerequisite in product screens.

## Build sequence

1. **Account:** open signup/sign-in with verified email and a display name.
2. **Mode switch:** persist Rider/Driver preference and load the corresponding dashboard.
3. **Driver flow:** save a commute template, publish a specific date, and see/respond to requests.
4. **Rider flow:** search published dated trips, request a seat, and see/cancel requests.
5. **Shared account:** switching modes must preserve the same identity and existing trips/requests. Users may own driver trips and rider requests at once; the current mode changes the view and allowed actions, not ownership of data.
6. **Reliability:** enforce authorization on the server; make mutations idempotent; serialize concurrent seat acceptance; handle cancellations and stale/expired trips consistently; keep private data out of public search results.
7. **Operational readiness:** provide clear support/reporting and account/data deletion procedures before inviting real users to arrange trips.

## What “simple” means

- Signup asks for name, email, and an initial mode.
- The dashboard has a clearly visible Rider / Driver toggle.
- Rider and Driver forms are separate views, but belong to one account.
- Do not require a user to join a workplace, school, association, or pilot group.
- Do not imply that email verification, a profile, or a match guarantees identity, vehicle condition, safe conduct, or an emergency response.
- Use approximate areas and share any precise pickup/contact information only when needed for an accepted trip and with the parties involved.

## Current implementation scope

Keep the first release to authentication, mode switching, commute templates, dated trip publishing/search, seat requests, driver accept/decline, and rider cancellation. Defer payments, live tracking, route optimization, ratings, identity document uploads, organization dashboards, and native apps until there is a concrete need.

## Release steps

1. Apply all database migrations, including the shared marketplace migration, to the intended development database.
2. Configure auth secret, base URL, email sender/provider, and `AUTH_ENABLED=true`; test local email links through the development terminal only on localhost.
3. Create two test accounts. Verify Rider-to-Driver and Driver-to-Rider switching, then exercise a dated trip from the two accounts.
4. Verify the same user can keep their own driver trips and rider requests after switching. Confirm authorization is enforced server-side, not just by hiding UI.
5. Resolve bugs and operational policies before production or real rides: abuse reporting, blocking, support contact, cancellation/no-show rules, data retention/deletion, and an incident response owner.

## Decision rule

Build this user flow because the founder has direct experience that motivates it. Use testing to find workflow defects and learn where the product is confusing; do not treat a lack of a formal community pilot as a reason users cannot create accounts. Keep the initial release small and revise it from observed behavior.
