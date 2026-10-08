# User and Trip Workflow Runbook

This describes the current product workflow. There is no manual community enrollment or invitation approval step.

## Account setup

1. User enters display name, email, and starting dashboard mode.
2. Auth sends a one-time email link; local development prints it in the dev server terminal.
3. On verified sign-in, the app creates or loads one account and automatically assigns it to the internal marketplace scope.
4. User arrives in Rider or Driver mode. They may switch from the dashboard at any time.

## Rider mode

1. Enter approximate pickup area, destination area, desired date, and departure time.
2. Review matching published trips and request a seat.
3. The request remains pending until the driver accepts or declines.
4. Rider may cancel according to the current request state. Show the outcome clearly. Ride-state changes create inbox notices; the dashboard polls while open, so delivery may be delayed.

## Driver mode

1. Enter approximate commute areas, usual departure window/days, and seats offered.
2. Publish a specific date when actually offering seats; a commute template alone is not a confirmed trip.
3. Review incoming requests and accept/decline them.
4. Do not exceed offered capacity. Accepted requests reserve seats transactionally.
5. A driver may cancel a future trip. The app withdraws its pending and accepted seat requests and removes the trip from search. Affected riders receive an in-app notice, but there is no email/SMS/push alert or guarantee anyone sees it promptly.

## Switching modes

Mode switching changes the dashboard view and available actions. It must not delete or hide ownership of the user's trips and requests. The same account can own driver trips and rider requests; the dashboard's shared activity view lists both regardless of selected mode.

## Reviewer workflow (safety reports and trip disputes)

Reviewer access is granted out-of-band, never from the app:

```bash
npm run db:set-reviewer-role -- <email> <OPERATOR|SAFETY_REVIEWER>
```

Only accounts whose membership role is `OPERATOR` or `SAFETY_REVIEWER` can open `/moderation/reports`. A closed account cannot be promoted back. A deployment that never runs this has no reviewer at all, so the queues below are invisible to everyone.

### What the queue shows

- **Open safety reports** (`RECEIVED`/`IN_REVIEW`) with reason, details, and the reported user.
- **Recently closed reports** (`RESOLVED`/`DISMISSED`) and each report's reviewer-only history: who submitted it, who changed its status, when, and the internal notes. Earlier transitions that predate the audit table appear as a clearly labelled historical snapshot, not as reconstructed history.
- **Trip disputes**: a participant's claim that an accepted trip did not happen as agreed. Each row also shows whether the rider and driver had confirmed, and whether an unconfirmed-trip record exists, so the decision is made with context rather than the claim alone.
- **Unconfirmed trips**: requests whose completion window closed without both sides confirming, with which side had confirmed. This is evidence to look into, never proof that someone failed to show up.

### Actions a reviewer can take

- **Safety report:** start review, resolve, or dismiss, with internal notes. The reporter is told the new status but never sees the internal notes.
- **Trip dispute:** record only whether the trip happened. `Trip happened` marks the request `COMPLETED`; `Trip did not happen` marks it `EXPIRED`. Both participants are told the outcome; neither is penalised automatically.

### What the app does not do

The queue refreshes on focus and every 30 seconds while open, but **sends no alert**. It does not page, email, or SMS anyone, guarantee a response time, or monitor itself. A named reviewer must check it during published support hours. Do not promise safety monitoring or emergency response. Nothing in the app enforces a consequence for a no-show or a dispute outcome — those are policy decisions that remain unresolved.

## Operational support

Before real use, publish support contact/hours, cancellation/no-show/cost-sharing rules, report/block flow, retention/deletion policy, and an incident escalation procedure in the app. Current product testing does not provide those operational services automatically. Do not promise safety monitoring or emergency response. `npm run db:audit-retention` reports aged data volumes to inform the retention policy; no retention window is applied to reports, trips, or closed accounts yet.
