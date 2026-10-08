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
- Document retention and deletion periods for auth sessions, accounts, commutes, trips, and reports before production use. Provide a way to request account/data deletion.
- Keep secrets in environment configuration, never source control or client code. Restrict database access and backups.

## Before real rides

Name a support contact and realistic support hours. Publish clear rules for requests, acceptance, cancellation, no-shows, cost sharing, and disputes. Provide a way to block another user and submit a report. Define who reviews a report, how urgent reports are escalated, when accounts/trips are suspended, how evidence is handled, and how decisions are recorded.

Tell users plainly that the app is not an emergency service and does not continuously monitor rides. Provide the appropriate local emergency guidance only after it has been checked. Obtain qualified local review for legal, insurance, transport, privacy, and any other obligations that apply before facilitating real rides.

## Incident principle

Any credible serious safety, privacy, or account-security concern pauses the affected live feature while it is assessed. Record the report, response owner, action, and resolution with access restricted. Low report counts are not evidence of low risk, especially with small usage.

## Local testing

Use test accounts and approximate/sample trip details. Do not publish actual commute details or arrange real trips through a local development environment. A local test account is not an approved or vetted driver/rider.
