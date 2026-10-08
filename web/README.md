# Carpool Pakistan web app

Users create an account with email verification and choose Rider or Driver as the starting dashboard. A single account can switch modes at any time. Signup does not require an invitation, community choice, sponsor, or operator approval. The database retains an internal shared marketplace scope that users never manage.

## Local setup

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL`, `DATABASE_SSL`, `AUTH_SECRET` (random, at least 32 characters), `BETTER_AUTH_URL=http://localhost:3000`, and `AUTH_ENABLED=true`.
3. Apply migrations to the intended development database: `npm run db:migrate`. The runner is checksum-checked and serializes concurrent runs. Migration `0006_open_marketplace.sql` is required for the open signup flow.
4. Start the app: `npm run dev`.
5. Open `http://localhost:3000/login`, enter a name and email, choose the initial mode, and submit. In local development on localhost, the one-time sign-in link is printed in the terminal running `npm run dev`.
6. Open that link, then switch Rider/Driver using the dashboard toggle.

For hosted/non-local environments, configure a verified email sender with `RESEND_API_KEY` and `AUTH_EMAIL_FROM`, use HTTPS for `BETTER_AUTH_URL`, and keep secrets out of source control. Do not expose local terminal-link behavior to a deployed environment.

## Main flows

- **Rider:** search for a dated trip, request a seat, view/cancel requests.
- **Driver:** save a commute, publish a specific trip date, review and accept/decline requests.
- A seat request is not confirmed until the driver accepts it.
- The mode is a dashboard/action context, not an account type. Both kinds of records belong to the same account.

## Database

Migrations live in `db/migrations`. `npm run db:migrate` applies unapplied migrations atomically, checks checksums, and uses an advisory lock. It changes only the database specified by `DATABASE_URL`; check that URL before running. Migration 0006 creates the automatic marketplace scope and activates existing accounts in it. Do not run migrations against a shared/production database unless that is the intended operation.

## Readiness limits

This implementation supports local product-flow testing. It does not verify identity, driving eligibility, vehicle condition, or user trust; it does not provide emergency response or trip monitoring. Before facilitating real rides, complete support/reporting/blocking, cancellation/no-show/cost-sharing rules, account/data deletion and retention, incident response, and applicable local review. See repository-level `MVP_SPEC.md` and `SAFETY_PRIVACY.md`.
