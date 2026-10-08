import nextEnv from "@next/env";
import { Pool } from "pg";

/**
 * Report what data exists by age, without changing anything.
 *
 * Retention policy is not decided yet, so nothing here deletes. This exists to
 * make the decision concrete: it shows how much closed-account, report, trip and
 * notification data is older than a candidate window, so a retention period can
 * be chosen from real volume instead of guesswork. Every query is read-only.
 *
 * Usage:
 *   node ./scripts/audit-retention.mjs [--as-of-days=<n>]
 *
 * `--as-of-days` (default 365) is the age threshold to report against. Use a few
 * values to see how volume changes, e.g. --as-of-days=90 --as-of-days=365.
 */

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", {
  info: () => {},
  error: () => {},
});

const thresholds = process.argv
  .filter((arg) => arg.startsWith("--as-of-days="))
  .map((arg) => Number(arg.slice("--as-of-days=".length)));
const windows = thresholds.length > 0 ? thresholds : [90, 180, 365, 1095];
for (const days of windows) {
  if (!Number.isInteger(days) || days < 1 || days > 36500) {
    throw new Error("--as-of-days must be an integer between 1 and 36500.");
  }
}

const configuredConnectionString = process.env.DATABASE_URL;
if (!configuredConnectionString) {
  throw new Error("Set DATABASE_URL before auditing retention.");
}

let connectionString = configuredConnectionString;
if (process.env.DATABASE_SSL === "true") {
  const url = new URL(configuredConnectionString);
  if (["sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key))) {
    throw new Error(
      "Custom SSL certificate parameters are unsupported; use the provider's standard verified TLS connection URI.",
    );
  }
  url.searchParams.delete("sslmode");
  connectionString = url.toString();
}

const pool = new Pool({
  connectionString,
  application_name: "carpool-retention-audit",
  max: 1,
  connectionTimeoutMillis: 5_000,
  ...(process.env.DATABASE_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

try {
  const client = await pool.connect();
  try {
    // Run read-only so a mistake cannot delete anything.
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20s'");

    for (const days of windows) {
      const result = await client.query(
        `SELECT
           (SELECT count(*)::int FROM users
             WHERE status = 'DEACTIVATED' AND updated_at < now() - ($1::int * interval '1 day')) AS closed_accounts,
           (SELECT count(*)::int FROM account_deletion_requests
             WHERE completed_at IS NOT NULL AND completed_at < now() - ($1::int * interval '1 day')) AS closure_records,
           (SELECT count(*)::int FROM safety_reports
             WHERE created_at < now() - ($1::int * interval '1 day')) AS safety_reports,
           (SELECT count(*)::int FROM safety_report_events
             WHERE created_at < now() - ($1::int * interval '1 day')) AS report_events,
           (SELECT count(*)::int FROM trip_disputes
             WHERE resolved_at IS NOT NULL AND resolved_at < now() - ($1::int * interval '1 day')) AS resolved_disputes,
           (SELECT count(*)::int FROM trip_occurrences
             WHERE trip_date < (now() - ($1::int * interval '1 day'))::date) AS past_trips,
           (SELECT count(*)::int FROM ride_requests
             WHERE created_at < now() - ($1::int * interval '1 day')) AS old_requests,
           (SELECT count(*)::int FROM trip_no_show_evidence
             WHERE expired_at < now() - ($1::int * interval '1 day')) AS no_show_evidence,
           (SELECT count(*)::int FROM in_app_notifications
             WHERE read_at IS NOT NULL AND created_at < now() - ($1::int * interval '1 day')) AS prunable_notifications,
           (SELECT count(*)::int FROM in_app_notifications
             WHERE read_at IS NULL AND created_at < now() - ($1::int * interval '1 day')) AS unread_old_notifications,
           (SELECT count(*)::int FROM idempotency_records
             WHERE expires_at <= now() - ($1::int * interval '1 day')) AS expired_idempotency`,
        [days],
      );
      process.stdout.write(`\nOlder than ${days} day(s):\n${JSON.stringify(result.rows[0], null, 2)}\n`);
    }

    const totals = await client.query(
      `SELECT
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM trip_occurrences) AS trips,
         (SELECT count(*)::int FROM ride_requests) AS requests,
         (SELECT count(*)::int FROM safety_reports) AS reports,
         (SELECT count(*)::int FROM trip_disputes) AS disputes,
         (SELECT count(*)::int FROM in_app_notifications) AS notifications,
         (SELECT count(*)::int FROM idempotency_records) AS idempotency_records`,
    );
    process.stdout.write(`\nCurrent totals:\n${JSON.stringify(totals.rows[0], null, 2)}\n`);

    process.stdout.write(
      "\nRead-only audit. No rows were changed. Use this to choose a retention window, then apply it deliberately.\n" +
        "Note: 'prunable_notifications' is what `npm run db:prune-notifications` would consider; " +
        "'unread_old_notifications' is deliberately never pruned by that command.\n",
    );

    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
