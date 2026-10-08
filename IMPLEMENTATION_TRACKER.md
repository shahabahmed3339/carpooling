# Implementation Tracker

Last updated: 2026-10-08

Static checks (lint, `tsc --noEmit`, `next build`) pass. Behaviour below was verified by driving the real app in a headless browser against the configured PostgreSQL database.

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
- Users can close their own account from the dashboard. Open requests are withdrawn, future trips cancelled, the account deactivated, identifying fields erased, memberships released, and sessions deleted; historical records survive as an anonymous tombstone.
- Safety reporting UI, reviewer queue at `/moderation/reports` restricted to `OPERATOR`/`SAFETY_REVIEWER`, and reporter-visible status.
- Updated active product/operations docs: `plan.md`, `MVP_SPEC.md`, `PILOT_BRIEF.md`, `SAFETY_PRIVACY.md`, `CONCIERGE_RUNBOOK.md`, and `DECISIONS.md`.
- Removed dead demo-only code (`src/data/demo-commutes.ts`, `src/domain/commute.ts`, the unused preview stylesheet). The app no longer ships a synthetic ride preview.

## In progress / verify

- Apply `web/db/migrations/0006_open_marketplace.sql`, `0007_normalized_area_search_index.sql`, and `0008_safety_reports.sql` to the intended local database. All are authored; 0008 may still need to be run.
- Verified in a real browser against PostgreSQL (this session): open signup, magic-link verification, mode selection, driver commute creation, dated trip publication, rider search with different capitalization/whitespace, seat request, driver accept, capacity increment, and the shared activity view.
- Not yet exercised in a browser: trip cancellation, block/unblock, report submission and review, and the moderation queue.

## Verified behavior this session

- **Trip completion implemented and verified.** Both sides confirm independently; the request completes only when both confirm, and settles to `EXPIRED` if the `completion_window` lapses first. Disputes are recorded in `trip_disputes` and move the request to `DISPUTED`. A request that was never accepted and whose trip has departed is expired rather than left showing an "Accept" control the server will refuse.
- **Capacity-settlement bug found and fixed.** Closing a trip (via confirmation or the expiry sweep) set the status but never released `seats_reserved`, so a finished trip permanently held seats that no request accounted for. That breaks the invariant overbooking protection relies on. Migration `0011` backfills already-closed trips.
- **No-show evidence implemented and verified.** When a completion window lapses, the sweep records which side had confirmed (`RIDER_UNCONFIRMED`, `DRIVER_UNCONFIRMED`, `NEITHER_CONFIRMED`) in `trip_no_show_evidence`, preserving the flags as they stood at expiry. Reviewers see it at `/moderation/reports` under "Unconfirmed trips". It is evidence for a human, never an automatic penalty.
- **Duplicate expiry sweep removed.** `requests.ts` carried its own copy of the sweep, which had drifted: it closed trips without settling capacity and recorded no evidence. It now delegates to the single canonical implementation in `completion.ts`, so the read path cannot diverge again.
- **Invariant check extended.** `web/scripts/verify-completion.mjs` now also asserts evidence matches its request and outcome, and that settled requests carry no no-show evidence. All 8 pass. `web/scripts/verify-no-show.mjs` exercises the expiry path end to end (9 checks, including that re-running the sweep never duplicates evidence).

- **Published-trips race fixed.** The dashboard previously issued two overlapping loads; a slow earlier response could overwrite newer data, so a freshly published trip did not appear. The loader is now a single guarded function with a monotonic sequence number, and the initial load is deferred out of the effect body.
- **Area normalization unified.** Template creation previously validated raw length while search validated normalized length, so the same input could be accepted by one path and rejected by the other. Both now use `normalizeArea` from `src/domain/clock.ts`.
- **Environment loading.** `AUTH_DEV_SANDBOX` and `PILOT_COMMUNITY_ID` are obsolete and no longer referenced by any code. They still exist in the untracked `web/.env`; remove them.
- Lint, TypeScript, and production build checks pass.
- Remaining verification gap: static checks and these browser runs cannot establish email delivery to real inboxes, concurrency under real parallel load, or recoverability.

## Not implemented / needed before real users arrange rides

- A staffed support route. Reporting storage, the reviewer queue, and blocking exist; nothing sends an alert, and a reviewer must check the queue.
- Finalized retention schedule (what is kept, for how long, and by whom). Account closure exists, but the retention window for closed accounts is not defined.
- Published cancellation, no-show, contribution/cost-sharing, and dispute terms.
- Incident response owner/process and any applicable local legal/insurance/privacy review.
- Production sender/domain, production secrets/base URL, deployment and recovery procedures.
- No-show *policy*. Evidence is now recorded (`trip_no_show_evidence`) and visible to reviewers, but nothing acts on it: there is no threshold, warning, suspension, or appeal path. Deciding what a pattern of unconfirmed trips should trigger is a product and fairness decision, not an implementation detail.
- Automated notifications for acceptance, cancellation, or trip changes. Users must reload the dashboard to see an updated status.
- Geographic area matching. Areas match on normalized text only; nearby neighborhoods are not treated as equivalent.

## Migration and environment notes

- Do not set or rely on `AUTH_DEV_SANDBOX` or `PILOT_COMMUNITY_ID`; the open-marketplace flow no longer uses them.
- `AUTH_ENABLED=true` enables authentication. Before using outside localhost, configure email delivery, valid HTTPS `BETTER_AUTH_URL`, strong `AUTH_SECRET`, database schema, and production privacy/security controls.
- `0006_open_marketplace.sql` adds the automatic marketplace and activates existing app accounts in that scope. `0007_normalized_area_search_index.sql` indexes normalized area comparisons. Neither migration has been run by this implementation session.
- Never paste `.env.local`, database URLs, auth secrets, or provider keys into chat or commit them.

## Source of truth

Use `MVP_SPEC.md` for current product behavior and `plan.md` for the implementation sequence. `carpooling_plan.md` remains unchanged as historical vision material. Revision 4 strategy text is superseded by the later decision for open signup and switchable roles.
