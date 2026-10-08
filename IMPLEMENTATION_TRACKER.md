# Implementation Tracker

Last updated: 2026-10-08

## Product direction

Open email signup. One user account can switch between Rider and Driver. There is no user-facing community, invitation, sponsor, or operator requirement. The database's community/membership structure is retained only as an automatic internal marketplace scope.

## Implemented in the workspace

- Better Auth email magic-link signup/sign-in, with local development links printed to the dev server terminal.
- Signup name and starting Rider/Driver mode.
- Automatic account creation and assignment to the internal marketplace scope.
- Dashboard with Rider and Driver modes and persistent mode switching.
- Driver commute templates, dated trip publishing, request inbox, accept/decline controls.
- Driver can edit a saved commute from the dashboard; optimistic version checks prevent stale edits from overwriting newer changes, and publication locks serialize against edits.
- Rider dated trip search, seat request, request list, cancellation control.
- Driver dashboard list of the account's upcoming published dated trips, including status and seat counts.
- Drivers can cancel a future published trip; cancellation and withdrawal of its pending/accepted seat requests happen atomically.
- Shared activity view lists the account's driver trips and rider/driver requests regardless of currently selected dashboard mode.
- Users can block/unblock participants from search results or activity; blocks persist, suppress future matches, and are checked transactionally before a new request is created or accepted.
- Area matching ignores capitalization and repeated whitespace; it still requires the same area name.
- Driver publish-date form explains the weekly schedule and prevents selecting a date outside the commute's selected weekdays.
- Authenticated service/API boundaries, database migrations, idempotency support in trip mutations, and transaction-based capacity handling in existing domain services.
- Updated active product/operations docs: `plan.md`, `MVP_SPEC.md`, `PILOT_BRIEF.md`, `SAFETY_PRIVACY.md`, `CONCIERGE_RUNBOOK.md`, and `DECISIONS.md`.

## In progress / verify

- Apply `web/db/migrations/0006_open_marketplace.sql` and `0007_normalized_area_search_index.sql` to the intended local database. Both are authored but must be run by the developer.
- Verify the complete local flow with two separate accounts: signup, link sign-in, role switching, driver creates dated trip, rider searches/requests, driver responds, rider sees result.
- Confirm cross-mode data persistence: the same account's driver trips and rider requests remain owned after toggling.
- Lint and TypeScript checks pass after these changes.
- Production build passes with Next's TypeScript API checker enabled through `experimental.useTypeScriptCli: false`; this avoids the CLI `--showConfig` parsing failure in this environment.
- Verify actual behavior in a browser. Static checks cannot establish email delivery, database migration state, race behavior, or end-to-end UX.

## Not implemented / needed before real users arrange rides

- Reporting UI/storage and a staffed support route; blocking exists, but does not cancel existing requests or accepted trips.
- Account/data deletion workflow and finalized retention schedule.
- Published cancellation, no-show, contribution/cost-sharing, and dispute terms.
- Incident response owner/process and any applicable local legal/insurance/privacy review.
- Production sender/domain, production secrets/base URL, deployment and recovery procedures.

## Migration and environment notes

- Do not set or rely on `AUTH_DEV_SANDBOX` or `PILOT_COMMUNITY_ID`; the open-marketplace flow no longer uses them.
- `AUTH_ENABLED=true` enables authentication. Before using outside localhost, configure email delivery, valid HTTPS `BETTER_AUTH_URL`, strong `AUTH_SECRET`, database schema, and production privacy/security controls.
- `0006_open_marketplace.sql` adds the automatic marketplace and activates existing app accounts in that scope. `0007_normalized_area_search_index.sql` indexes normalized area comparisons. Neither migration has been run by this implementation session.
- Never paste `.env.local`, database URLs, auth secrets, or provider keys into chat or commit them.

## Source of truth

Use `MVP_SPEC.md` for current product behavior and `plan.md` for the implementation sequence. `carpooling_plan.md` remains unchanged as historical vision material. Revision 4 strategy text is superseded by the later decision for open signup and switchable roles.
