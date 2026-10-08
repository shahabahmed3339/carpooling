# Implementation Tracker

Last updated: 2026-10-07

## Product direction

Open email signup. One user account can switch between Rider and Driver. There is no user-facing community, invitation, sponsor, or operator requirement. The database's community/membership structure is retained only as an automatic internal marketplace scope.

## Implemented in the workspace

- Better Auth email magic-link signup/sign-in, with local development links printed to the dev server terminal.
- Signup name and starting Rider/Driver mode.
- Automatic account creation and assignment to the internal marketplace scope.
- Dashboard with Rider and Driver modes and persistent mode switching.
- Driver commute templates, dated trip publishing, request inbox, accept/decline controls.
- Rider dated trip search, seat request, request list, cancellation control.
- Authenticated service/API boundaries, database migrations, idempotency support in trip mutations, and transaction-based capacity handling in existing domain services.
- Updated active product/operations docs: `plan.md`, `MVP_SPEC.md`, `PILOT_BRIEF.md`, `SAFETY_PRIVACY.md`, `CONCIERGE_RUNBOOK.md`, and `DECISIONS.md`.

## In progress / verify

- Apply `web/db/migrations/0006_open_marketplace.sql` to the local development database. This migration has been authored but must be run by the developer against the intended database.
- Verify the complete local flow with two separate accounts: signup, link sign-in, role switching, driver creates dated trip, rider searches/requests, driver responds, rider sees result.
- Confirm cross-mode data persistence: the same account's driver trips and rider requests remain owned after toggling.
- Lint and TypeScript checks pass after these changes.
- Production build compiles application code, but Next.js fails in its TypeScript stage with `Could not parse output from TypeScript's --showConfig`; standalone `npx tsc --noEmit` passes. This build/tooling issue remains unresolved.
- Verify actual behavior in a browser. Static checks cannot establish email delivery, database migration state, race behavior, or end-to-end UX.

## Not implemented / needed before real users arrange rides

- Reporting/blocking screens and a staffed support route.
- Account/data deletion workflow and finalized retention schedule.
- Published cancellation, no-show, contribution/cost-sharing, and dispute terms.
- Incident response owner/process and any applicable local legal/insurance/privacy review.
- Production sender/domain, production secrets/base URL, deployment and recovery procedures.
- A unified activity view for records created while switching roles (current dashboard is role-focused).

## Migration and environment notes

- Do not set or rely on `AUTH_DEV_SANDBOX` or `PILOT_COMMUNITY_ID`; the open-marketplace flow no longer uses them.
- `AUTH_ENABLED=true` enables authentication. Before using outside localhost, configure email delivery, valid HTTPS `BETTER_AUTH_URL`, strong `AUTH_SECRET`, database schema, and production privacy/security controls.
- `0006_open_marketplace.sql` adds the automatic marketplace and activates existing app accounts in that scope. It has not been run by this implementation session.
- Never paste `.env.local`, database URLs, auth secrets, or provider keys into chat or commit them.

## Source of truth

Use `MVP_SPEC.md` for current product behavior and `plan.md` for the implementation sequence. `carpooling_plan.md` remains unchanged as historical vision material. Revision 4 strategy text is superseded by the later decision for open signup and switchable roles.
