# MVP Specification — Open Signup, Switchable Modes

## Goal

Let any person create one email-verified account and use it as a Rider, a Driver, or both by switching dashboard mode.

## Terms

- **Account:** one identity associated with a verified email.
- **Mode:** currently selected dashboard/action context (`RIDER` or `DRIVER`). It can change at any time.
- **Commute:** a reusable description of a driver's usual route/schedule.
- **Dated trip:** an actual offer to travel on one date, derived from a commute or otherwise published. The selected usual weekdays restrict which dates can be published; they do not auto-publish trips.
- **Seat request:** a rider's request to join a dated trip. It is not accepted until the driver accepts it.
- **Internal marketplace scope:** database tenant used for existing data isolation. It is automatic and invisible to users; it is not a community signup requirement.

## Functional scope

1. **Open signup/sign-in:** name + email + one-time verification link. No invitation, community selection, operator review, or organization membership gate.
2. **Starting mode:** signup may choose Rider or Driver to select the first dashboard view.
3. **Mode switch:** a visible toggle in the dashboard updates the stored preference. Verify eligibility and ownership on every API request.
4. **Driver:** create/list/update commute templates from the dashboard; publish specific dated trips; list and accept/decline rider requests.
5. **Rider:** search open dated trips; request a seat; list/cancel own requests.
6. **One identity:** a user may hold records from both modes. Switching the current mode must not mutate/delete trip or request ownership.
7. **Cross-mode activity:** show the account's own trips and requests in a shared activity list in either mode; keep role-specific actions in their corresponding dashboard views.
8. **Trip state:** validate transitions and capacity transactionally; use idempotency keys for mutating requests; repeated submission must not duplicate effects.
9. **Driver cancellation:** before departure, the driver can cancel a published trip. Pending and accepted requests are withdrawn in the same transaction, and the trip is removed from search.
10. **Privacy:** search returns approximate trip areas and only necessary participant display information. Do not expose private contact details without a valid coordination need.
11. **Area matching:** compare trimmed area names case-insensitively and collapse repeated whitespace. Do not infer that different neighborhood names are nearby or equivalent.
12. **Blocking:** users can block/unblock another participant. A block suppresses future matches and prevents a new request from being created or accepted; it does not automatically cancel an existing accepted trip.
13. **Reporting:** a user can submit a safety report about a participant they share an actual trip or request with, and can see the status of their own reports. Active operators/safety reviewers receive an in-app notice for new reports; reporters receive a status notice when review status changes. Reviewer actions are retained in a reviewer-only event history. These are not external alerts or emergency channels.
14. **Account closure:** a user can close their own account. Open requests are withdrawn, future trips cancelled, the app account is deactivated, authentication identity/credentials/sessions and outstanding magic-link sign-in tokens for that email are deleted, and identifying fields are erased from the retained app row. Completed history remains against that anonymous app row so other participants' records stay coherent. Closure is refused while a trip the user is part of has already departed.
15. **Reviewer access:** the report queue is restricted server-side to members with the operator or safety-reviewer role. It is not visible to ordinary accounts.
16. **Reviewer queue freshness:** while the moderation page is open, reports and unconfirmed-trip evidence refresh on focus and periodically while visible; a notice is still not a staffed alert.
17. **Trip completion:** each side confirms independently after departure; the request becomes `COMPLETED` only when both confirm. A request unconfirmed when the completion window lapses becomes `EXPIRED`.
18. **Unconfirmed-trip evidence:** for each expired request, record which side had confirmed, at the moment of expiry. Staff can view this as context during a review. It is evidence, never an automatic penalty: not confirming is not proof that someone did not travel.
19. **In-app notifications:** persist inbox updates for seat requests and state changes, completion confirmation/expiry, and disputes in the same transaction as the underlying change. Users can mark notifications read and load older entries through cursor pagination. The dashboard checks for updates while visible; no email, SMS, or push alerts are sent.

## Non-goals for the first slice

Payments, escrow, location tracking, route optimization, ratings/reputation, identity-document collection, organization dashboards, multi-tenant user-facing groups, native apps, and automated safety monitoring.

## Readiness and honest product language

Open account creation means users can test the product flow without a pilot organizer. It does not mean a real ride has been vetted or that the platform provides emergency response. Before enabling real rides, ship support/reporting/blocking, cancellation/no-show terms, retention/deletion controls, and an incident process; complete applicable qualified local review.

Trip completion exists, but no-show *policy* does not: the app records that a confirmation never arrived and shows it to staff, yet nothing acts on it. There is no threshold, warning, suspension, or appeal path, so the evidence should be read only as context during a human review.

## Technical constraints

- PostgreSQL remains authoritative for user role preference and trip/request state.
- Keep transactions short. Lock/update trip capacity consistently during concurrent accept operations.
- Keep database ownership checks in service/API layer; never rely solely on dashboard visibility.
- Mark authenticated app API responses, including errors, and Better Auth API responses `Cache-Control: private, no-store`; dashboard fetches explicitly bypass browser caches because payloads are user-, trip-, or session-specific.
- Bind dashboard and reviewer requests to the account that rendered the page; reject stale-tab operations server-side if the shared browser session changes. Broadcast sign-in, sign-out, and account-closure changes to same-origin tabs using `BroadcastChannel` and a `localStorage` event, then clear personalized state before navigating; API response checks remain the fallback.
- Recheck the persisted Rider/Driver mode inside mode-gated write transactions after taking the same per-account lock as mode changes. Notify same-account tabs over both browser transports after a mode switch and use authenticated response metadata to reload stale mode views.
- Safety-report audit events are append-only at the database layer; migration `0017_safety_report_events_append_only.sql` rejects updates, deletes, and truncation.
- Idempotency results replay for 24 hours; a key can be reused for a fresh operation after that interval. `npm run db:prune-idempotency` deletes up to 500 expired rows per invocation and needs periodic scheduling in each environment.
- The dashboard retains pending retry keys across same-tab reloads for at most 23 hours, with a fingerprint of account, method, route, and payload; it stores neither request bodies nor safety-report text in that map.
- Use migrations for schema changes and do not apply them to a shared/production database without the owner deliberately running them.
- Internal `community_id` should refer to one automatic marketplace row for all current accounts. Do not add community selection to signup/UI.
- `web/db/migrations/0013_in_app_notifications.sql` adds the notification inbox, `0014_safety_report_inbox_notifications.sql` adds reviewer notices for new reports, `0015_reporter_status_notifications.sql` adds reporter status notices, `0016_safety_report_audit_events.sql` adds reviewer-only report history, and `0017_safety_report_events_append_only.sql` prevents audit-event mutation and truncation. Migrations `0013`–`0016` are applied to the configured project database; `0017` is authored but still needs to be applied. Apply these migrations to any other environment before use.
