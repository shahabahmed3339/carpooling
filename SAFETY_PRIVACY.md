# Safety and Privacy Requirements

**Status:** Product requirements, not a statement that the service or any ride is safe. Local account testing must use fictional/sample data. Resolve operational items before facilitating real trips.

## Account and roles

- Any user may register with verified email; there is no invitation, community approval, or organization eligibility check.
- Rider and Driver are switchable modes on one account. Do not create duplicate accounts to use both roles.
- Email verification confirms access to an email address only. It does not verify legal identity, driving eligibility, vehicle condition, or trustworthiness.
- Do not collect CNIC, identity-document images, or precise home addresses by default.

## Data handling

- Collect only fields needed for account access and dated-trip matching.
- Use approximate origin/destination areas in search and listings.
- Limit access to account, commute, and trip data to the account owner and parties who need it to coordinate a requested/accepted trip.
- Do not expose email, phone, exact pickup location, or vehicle details in public search responses.
- Account closure is self-service: a user can deactivate their own account from the dashboard. Closure withdraws open requests, cancels future trips, erases the display name and auth subject, releases the membership, and deletes sessions. A closed account keeps an opaque row so other participants' trip history stays valid; it retains no email, name, or sign-in ability.
- Closure is refused while a trip the user is part of has already departed, so a counterparty is never left on a trip that was silently cancelled mid-way.
- Still to define: how long closed-account tombstones, reports, and completed trip history are retained, and what is purged on a schedule versus kept for dispute handling.
- Keep secrets in environment configuration, never source control or client code. Restrict database access and backups.

## Before real rides

Name a support contact and realistic support hours. Publish clear rules for requests, acceptance, cancellation, no-shows, cost sharing, and disputes. Provide a way to block another user and submit a report. Define who reviews a report, how urgent reports are escalated, when accounts/trips are suspended, how evidence is handled, and how decisions are recorded.

The current block control removes a participant from future matching and prevents a pending request from being newly accepted. Blocking does not automatically cancel existing requests or accepted trips. Direct users to visible trip/request controls and the published support route when they need help; do not present blocking as emergency response or a guarantee of separation in every context.

A report can only be filed about a participant the reporter actually shares a trip or request with, and the queue is visible only to accounts holding the operator or safety-reviewer role. Reports do not notify anyone: nothing pages a human, so an unread queue is indistinguishable from no reports. Treat an unstaffed queue as a launch blocker, not a backlog.

### Unconfirmed trips are evidence, not blame

When a completion window lapses, the app records which side had confirmed. That record answers "who did not press the button", which is **not** the same question as "who did not turn up". A user may travel and never reopen the app; a phone may be dead; a rider may have been picked up by a different driver by arrangement outside the app. Treating an unconfirmed flag as a no-show would penalise people for not using software.

Therefore:

- Do not present an unconfirmed trip to any user as an accusation, a rating, or a penalty.
- Do not automate consequences (suspension, deprioritisation, public labelling) from this data alone.
- Before acting on a pattern, define the appeal path and the human review that must precede it. Nothing like that exists yet, so the data should currently be read only, for context during a review.
- Keep the reviewer-facing explanation honest: it is a prompt to look into something, not a finding.

Tell users plainly that the app is not an emergency service and does not continuously monitor rides. Provide the appropriate local emergency guidance only after it has been checked. Obtain qualified local review for legal, insurance, transport, privacy, and any other obligations that apply before facilitating real rides.

## Incident principle

Any credible serious safety, privacy, or account-security concern pauses the affected live feature while it is assessed. Record the report, response owner, action, and resolution with access restricted. Low report counts are not evidence of low risk, especially with small usage.

## Local testing

Use test accounts and approximate/sample trip details. Do not publish actual commute details or arrange real trips through a local development environment. A local test account is not an approved or vetted driver/rider.
