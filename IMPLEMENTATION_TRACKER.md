# Implementation Tracker

Last updated: 2026-10-08

Static checks (`npm run lint`, `npx tsc --noEmit`, `npm run build`) pass. Browser verification is listed by scope below; do not infer that unlisted flows were exercised.

## Product direction

Open email signup. One user account can switch between Rider and Driver. There is no user-facing community, invitation, sponsor, or operator requirement. The database's community/membership structure is retained only as an automatic internal marketplace scope.

## Implemented in the workspace

- Better Auth email magic-link signup/sign-in, with local development links printed to the dev server terminal.
- Signup name and starting Rider/Driver mode.
- Automatic account creation and assignment to the internal marketplace scope.
- Dashboard with Rider and Driver modes and persistent mode switching.
- Visiting `/login` with an active authenticated account redirects to `/dashboard`; signed-out users retain the signup/sign-in flow.
- Dashboard and reviewer-page requests send the account ID that rendered the page; the server rejects a mismatch before running a protected operation. Responses identify the actor, and sign-in completion, sign-out, and account closure broadcast identity changes over `BroadcastChannel` plus a `localStorage` event so personalized state clears immediately. Signals are size-bounded, validated, and deduplicated; older timestamps are ignored. API response checks remain the fallback when both browser transports are unavailable. A 401 redirects to sign-in.
- Mode-gated writes recheck the account's current Rider/Driver mode inside the mutation transaction after acquiring the same per-account lock used by mode changes. This closes the race where a stale Driver tab could publish after the account switched to Rider. A successful mode switch signals other same-account tabs over `BroadcastChannel` plus a `localStorage` event; protected responses also report the current mode so a stale tab detects it on its next request if browser messaging is unavailable. Server authorization remains authoritative.
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
- Application-wide browser security headers: MIME sniffing and framing disabled, restricted referrer/permissions policy, same-origin opener policy, and production-only HSTS.
- Authenticated API responses (success and error), plus Better Auth API responses, set `Cache-Control: private, no-store`; dashboard requests also bypass browser caches to prevent personalized trip, account, notification, moderation, and session payloads being reused across sessions.
- Idempotency results now replay within their 24-hour window; after expiry, reusing the same actor/operation/key resets the record and executes a fresh operation.
- Dashboard mutations reuse their idempotency key for the exact same account, method, route, and body until a readable successful response; the opaque key and SHA-256 fingerprint survive same-tab reloads in `sessionStorage`, edited payloads get distinct keys, and report text is not persisted in that map. Stale client keys expire after 23 hours, inside the server's 24-hour replay window. This does not deduplicate an independently submitted operation from another tab.
- `npm run db:prune-idempotency` removes at most 500 expired idempotency rows per invocation in a `SKIP LOCKED` transaction.
- Users can close their own account from the dashboard. A shared per-account advisory lock serializes closure with account-owned mutations; open rider requests are withdrawn and accepted seat reservations released, future driver trips and their requests are cancelled with transactional in-app notices to affected participants, auth identity/credentials/sessions and outstanding magic links are deleted, and historical records survive as an anonymous tombstone.
- Safety reporting UI, reviewer queue at `/moderation/reports` restricted to `OPERATOR`/`SAFETY_REVIEWER`, and reporter-visible status.
- Safety report audit history: submissions and reviewer status changes are recorded as append-only events; row locking serializes simultaneous reviews and same-status retries do not create duplicate events. Pre-feature rows are marked as historical snapshots because earlier transitions cannot be reconstructed. Event history is reviewer-only.
- Reviewer page is server-rendered only for an authenticated account and binds polling, review, and history requests to that account; validated session-change broadcasts clear the sensitive queue immediately, with server response checks as a fallback.
- Moderation queue and unconfirmed-trip evidence refresh on focus and every 30 seconds while visible; monotonic request sequencing prevents a delayed response overwriting newer queue data.
- New safety reports create an in-app inbox notice for each active operator/safety reviewer in the internal marketplace scope; notice creation is atomic with report creation and links to the review queue. Review status changes create reporter-only notices without exposing internal notes.
- Notification inbox uses keyset pagination with a stable `(created_at, id)` cursor; the API fetches at most 51 rows to determine whether another page exists. Older-page loads are single-flight and share a monotonic response sequence with polling/read updates, so stale responses cannot overwrite newer read state or counts. Personalized responses are explicitly non-cacheable.
- Updated active product/operations docs: `plan.md`, `MVP_SPEC.md`, `PILOT_BRIEF.md`, `SAFETY_PRIVACY.md`, `CONCIERGE_RUNBOOK.md`, and `DECISIONS.md`.
- Removed dead demo-only code (`src/data/demo-commutes.ts`, `src/domain/commute.ts`, the unused preview stylesheet). The app no longer ships a synthetic ride preview.

## In progress / verify

- Database migrations `0001` through `0016` applied successfully through `npm run db:migrate` against the configured database. `0013`–`0015` add notifications; `0016` adds safety-report audit events and backfills clearly labeled current-state snapshots. Migration `0017` adds triggers preventing updates, deletes, and truncation of audit events; it is authored but not applied.
- Verified in a real browser against PostgreSQL (this session): open signup, magic-link verification, mode selection, driver commute creation, dated trip publication, rider search with different capitalization/whitespace, seat request, driver accept, capacity increment, and the shared activity view.
- Not yet exercised in a browser: trip cancellation, block/unblock, report submission/review/history and the moderation queue.
- Not yet exercised in a browser: notification delivery between two sessions, unread counts/read marking, cancellation/completion/dispute notifications, and periodic inbox refresh.
- Not yet exercised in a browser: same-tab retry after an ambiguous mutation response.
- Not yet exercised in a browser: `BroadcastChannel`/storage mode-change delivery while another same-account dashboard is open, including attempting a stale mode-gated action during the switch.
- Not yet exercised in a browser: switching the shared session away from a reviewer while their moderation queue is open.
- Not yet exercised in a browser: `BroadcastChannel`/storage session-change delivery during sign-out, sign-in as a different account, or account closure while another same-origin dashboard/reviewer tab is open; browser feature restrictions and simultaneous rapid identity changes also need verification.
- The idempotency cleanup command has not been run; its deletion behavior still needs confirmation against the intended development database, then periodic scheduling in each environment.
- The notification-list SQL was corrected after inspection; a read-only live query check could not run in this environment because the configured database hostname did not resolve. Recheck inbox endpoints when database DNS/connectivity is available.
- The idempotency cleanup command is not scheduled by the app; configure a periodic job for each intended environment and invoke it repeatedly while catching up on a backlog.

## Verified behavior this session

- **Trip completion implemented and verified.** Both sides confirm independently; the request completes only when both confirm, and settles to `EXPIRED` if the `completion_window` lapses first. Disputes are recorded in `trip_disputes` and move the request to `DISPUTED`. A request that was never accepted and whose trip has departed is expired rather than left showing an "Accept" control the server will refuse.
- **Capacity-settlement bug found and fixed.** Closing a trip (via confirmation or the expiry sweep) set the status but never released `seats_reserved`, so a finished trip permanently held seats that no request accounted for. That breaks the invariant overbooking protection relies on. Migration `0011` backfills already-closed trips.
- **No-show evidence implemented and verified.** When a completion window lapses, the sweep records which side had confirmed (`RIDER_UNCONFIRMED`, `DRIVER_UNCONFIRMED`, `NEITHER_CONFIRMED`) in `trip_no_show_evidence`, preserving the flags as they stood at expiry. Reviewers see it at `/moderation/reports` under "Unconfirmed trips". It is evidence for a human, never an automatic penalty.
- **In-app notifications implemented.** Seat requests, accept/decline/cancel, trip cancellations, completion confirmations/completion, expiry, disputes, and new safety reports create recipient-scoped inbox entries in the same transaction as the state change. Safety reports notify active operators/reviewers in the internal scope. Stable unique event keys prevent duplicate entries; recipients control read state. The dashboard refreshes on load/action/focus and polls every 30 seconds while visible.
- **Duplicate expiry sweep removed.** `requests.ts` carried its own copy of the sweep, which had drifted: it closed trips without settling capacity and recorded no evidence. It now delegates to the single canonical implementation in `completion.ts`, so the read path cannot diverge again.
- **Trip lock order unified for expiry.** The completion sweep now locks due parent trips in ascending ID order before changing requests, in bounded `SKIP LOCKED` batches of 25. This matches acceptance/cancellation/account-closure lock ordering and avoids concurrent sweepers blocking on the same batch.
- **Invariant check extended.** `web/scripts/verify-completion.mjs` now also asserts evidence matches its request and outcome, and that settled requests carry no no-show evidence. All 8 pass. `web/scripts/verify-no-show.mjs` exercises the expiry path end to end (9 checks, including that re-running the sweep never duplicates evidence).

- **Published-trips race fixed.** The dashboard previously issued two overlapping loads; a slow earlier response could overwrite newer data, so a freshly published trip did not appear. The loader is now a single guarded function with a monotonic sequence number, and the initial load is deferred out of the effect body.
- **Area normalization unified.** Template creation previously validated raw length while search validated normalized length, so the same input could be accepted by one path and rejected by the other. Both now use `normalizeArea` from `src/domain/clock.ts`.
- **Environment loading.** Removed obsolete `AUTH_DEV_SANDBOX` and `PILOT_COMMUNITY_ID` assignments from the local `web/.env`; neither is referenced by code.
- Lint, TypeScript, and production build checks pass.
- Remaining verification gap: static checks and these browser runs cannot establish email delivery to real inboxes, concurrency under real parallel load, or recoverability.

## Not implemented / needed before real users arrange rides

- A staffed support route. Reporting storage, reviewer inbox notices, the queue, and blocking exist; notices are in-app only, with no paging or external alert, so a named reviewer must monitor the queue.
- Finalized retention schedule (what is kept, for how long, and by whom). Account closure exists, but the retention window for closed accounts is not defined.
- Published cancellation, no-show, contribution/cost-sharing, and dispute terms.
- Incident response owner/process and any applicable local legal/insurance/privacy review.
- Production sender/domain, production secrets/base URL, deployment and recovery procedures.
- No-show *policy*. Evidence is now recorded (`trip_no_show_evidence`) and visible to reviewers, but nothing acts on it: there is no threshold, warning, suspension, or appeal path. Deciding what a pattern of unconfirmed trips should trigger is a product and fairness decision, not an implementation detail.
- External notifications (email, SMS, push), notification retention/cleanup, and delivery outside the in-app inbox. Inbox polling is periodic, not real-time; reviewer notices do not guarantee anyone is online or monitoring.
- Apply migrations `0013`–`0017` to any other database environment before relying on notifications, safety-report history, and its append-only guard there.
- Geographic area matching. Areas match on normalized text only; nearby neighborhoods are not treated as equivalent.

## Migration and environment notes

- Do not set or rely on `AUTH_DEV_SANDBOX` or `PILOT_COMMUNITY_ID`; the open-marketplace flow no longer uses them.
- `AUTH_ENABLED=true` enables authentication. Before using outside localhost, configure email delivery, valid HTTPS `BETTER_AUTH_URL`, strong `AUTH_SECRET`, database schema, and production privacy/security controls.
- `0006_open_marketplace.sql` adds the automatic marketplace and activates existing app accounts in that scope. `0007_normalized_area_search_index.sql` indexes normalized area comparisons. `0013`–`0015` add in-app ride and safety-report notifications; `0016` adds report audit history; `0017` adds its append-only guard. Confirm the target before running migration commands in another environment.
- Never paste `.env.local`, database URLs, auth secrets, or provider keys into chat or commit them.

## Source of truth

Use `MVP_SPEC.md` for current product behavior and `plan.md` for the implementation sequence. `carpooling_plan.md` remains unchanged as historical vision material. Revision 4 strategy text is superseded by the later decision for open signup and switchable roles.
