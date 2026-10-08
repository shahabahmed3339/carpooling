# MVP Specification — Open Signup, Switchable Modes

## Goal

Let any person create one email-verified account and use it as a Rider, a Driver, or both by switching dashboard mode.

## Terms

- **Account:** one identity associated with a verified email.
- **Mode:** currently selected dashboard/action context (`RIDER` or `DRIVER`). It can change at any time.
- **Commute:** a reusable description of a driver's usual route/schedule.
- **Dated trip:** an actual offer to travel on one date, derived from a commute or otherwise published.
- **Seat request:** a rider's request to join a dated trip. It is not accepted until the driver accepts it.
- **Internal marketplace scope:** database tenant used for existing data isolation. It is automatic and invisible to users; it is not a community signup requirement.

## Functional scope

1. **Open signup/sign-in:** name + email + one-time verification link. No invitation, community selection, operator review, or organization membership gate.
2. **Starting mode:** signup may choose Rider or Driver to select the first dashboard view.
3. **Mode switch:** a visible toggle in the dashboard updates the stored preference. Verify eligibility and ownership on every API request.
4. **Driver:** create/list/update commute templates; publish specific dated trips; list and accept/decline rider requests.
5. **Rider:** search open dated trips; request a seat; list/cancel own requests.
6. **One identity:** a user may hold records from both modes. Switching the current mode must not mutate/delete trip or request ownership.
7. **Trip state:** validate transitions and capacity transactionally; use idempotency keys for mutating requests; repeated submission must not duplicate effects.
8. **Privacy:** search returns approximate trip areas and only necessary participant display information. Do not expose private contact details without a valid coordination need.

## Non-goals for the first slice

Payments, escrow, location tracking, route optimization, ratings/reputation, identity-document collection, organization dashboards, multi-tenant user-facing groups, native apps, and automated safety monitoring.

## Readiness and honest product language

Open account creation means users can test the product flow without a pilot organizer. It does not mean a real ride has been vetted or that the platform provides emergency response. Before enabling real rides, ship support/reporting/blocking, cancellation/no-show terms, retention/deletion controls, and an incident process; complete applicable qualified local review.

## Technical constraints

- PostgreSQL remains authoritative for user role preference and trip/request state.
- Keep transactions short. Lock/update trip capacity consistently during concurrent accept operations.
- Keep database ownership checks in service/API layer; never rely solely on dashboard visibility.
- Use migrations for schema changes and do not apply them to a shared/production database without the owner deliberately running them.
- Internal `community_id` should refer to one automatic marketplace row for all current accounts. Do not add community selection to signup/UI.
