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
4. Rider may cancel according to the current request state. Show the outcome clearly.

## Driver mode

1. Enter approximate commute areas, usual departure window/days, and seats offered.
2. Publish a specific date when actually offering seats; a commute template alone is not a confirmed trip.
3. Review incoming requests and accept/decline them.
4. Do not exceed offered capacity. Accepted requests reserve seats transactionally.

## Switching modes

Mode switching changes the dashboard view and available actions. It must not delete or hide ownership of the user's trips and requests. The same account can own driver trips and rider requests; the dashboard may show role-specific lists, with a later UI improvement to expose a unified activity history.

## Operational support

Before real use, publish support contact/hours, cancellation/no-show/cost-sharing rules, report/block flow, retention/deletion policy, and an incident escalation procedure in the app. Current product testing does not provide those operational services automatically. Do not promise safety monitoring or emergency response.
