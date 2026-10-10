import nextEnv from "@next/env";
import { Pool } from "pg";

/**
 * Delete settled trip and request history older than a retention window.
 *
 * `db:prune-notifications` and `db:prune-idempotency` already bound their tables,
 * but the core ride tables — `trip_occurrences`, `ride_requests`,
 * `trip_no_show_evidence`, `trip_disputes` — grow without limit. This command
 * applies the same discipline to them: bounded per invocation, safe by
 * construction, and honest about what it refuses to delete.
 *
 * Three rules make it safe, and they are the whole reason this is not one DELETE:
 *
 *   1. **Only settled history.** A trip is eligible only when it is `COMPLETED`
 *      or `CANCELLED`, and a request only when it is not `REQUESTED` or
 *      `ACCEPTED`. An open commitment is never touched, whatever its age.
 *   2. **Never delete safety evidence.** A `safety_reports` row references a trip
 *      (and a reporter/reported user). Reports are the record that an incident
 *      was raised, so a trip that any report points at is skipped entirely —
 *      evidence outlives the ride. The same applies to `safety_report_events`,
 *      which are append-only by database trigger.
 *   3. **Dependency order.** Evidence and disputes are deleted before the
 *      requests they hang off, and requests before their trips, because every
 *      foreign key in this schema is `ON DELETE RESTRICT` by design.
 *
 * Anything it declines to delete is counted and reported, so a shrinking
 * deletion count is explained rather than mysterious.
 *
 * Usage:
 *   node ./scripts/prune-history.mjs                       # delete (default 365 days)
 *   node ./scripts/prune-history.mjs --dry-run             # count only, delete nothing
 *   node ./scripts/prune-history.mjs --retention-days=180
 *   node ./scripts/prune-history.mjs --limit=1000
 */

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", {
  info: () => {},
  error: () => {},
});

function readFlag(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const dryRun = process.argv.includes("--dry-run");

const retentionDays = Number(readFlag("retention-days") ?? process.env.HISTORY_RETENTION_DAYS ?? 365);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) {
  throw new Error("--retention-days must be an integer between 1 and 36500.");
}

const limit = Number(readFlag("limit") ?? 500);
if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
  throw new Error("--limit must be an integer between 1 and 10000.");
}

const configuredConnectionString = process.env.DATABASE_URL;
if (!configuredConnectionString) {
  throw new Error("Set DATABASE_URL before pruning history.");
}

let connectionString = configuredConnectionString;
if (process.env.DATABASE_SSL === "true") {
  const url = new URL(configuredConnectionString);
  if (["sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key))) {
    throw new Error(
      "Custom SSL certificate parameters are unsupported; use the provider's standard verified TLS connection uri.",
    );
  }
  url.searchParams.delete("sslmode");
  connectionString = url.toString();
}

const pool = new Pool({
  connectionString,
  application_name: "carpool-prune-history",
  max: 2,
  connectionTimeoutMillis: 5_000,
  ...(process.env.DATABASE_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

/**
 * Trips eligible for deletion: settled, older than the window by trip date, and
 * referenced by no safety report. Ordered oldest first so repeated runs make
 * progress through a backlog instead of re-examining the same rows.
 */
const ELIGIBLE_TRIPS = `
  SELECT o.id
    FROM trip_occurrences o
   WHERE o.status IN ('COMPLETED', 'CANCELLED')
     AND o.trip_date < (now() - ($1::int * interval '1 day'))::date
     AND NOT EXISTS (SELECT 1 FROM safety_reports r WHERE r.trip_occurrence_id = o.id)
   ORDER BY o.trip_date ASC, o.id ASC
   LIMIT $2`;

/** Requests on those trips whose state is settled (never an open commitment). */
const ELIGIBLE_REQUESTS = `
  SELECT rr.id
    FROM ride_requests rr
   WHERE rr.trip_occurrence_id = ANY($1::uuid[])
     AND rr.status NOT IN ('REQUESTED', 'ACCEPTED')
   ORDER BY rr.created_at ASC, rr.id ASC`;

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '60s'");

    const eligibleTrips = await client.query(ELIGIBLE_TRIPS, [retentionDays, limit]);
    const tripIds = eligibleTrips.rows.map((row) => row.id);

    if (tripIds.length === 0) {
      await client.query("ROLLBACK");
      process.stdout.write(
        `\nNo settled trips older than ${retentionDays} day(s) with no safety report attached. Nothing to do.\n`,
      );
    } else {
      const eligibleRequests = await client.query(ELIGIBLE_REQUESTS, [tripIds]);
      const requestIds = eligibleRequests.rows.map((row) => row.id);

      // Counts are reported before deleting so a dry run and a real run agree.
      const counts = await client.query(
        `SELECT
           (SELECT count(*)::int FROM trip_no_show_evidence WHERE ride_request_id = ANY($1::uuid[])) AS evidence,
           (SELECT count(*)::int FROM trip_disputes WHERE ride_request_id = ANY($1::uuid[])) AS disputes,
           (SELECT count(*)::int FROM in_app_notifications WHERE resource_id = ANY($1::uuid[]) OR resource_id = ANY($2::uuid[])) AS notifications`,
        [requestIds, tripIds],
      );
      const summary = {
        retentionDays,
        limit,
        dryRun,
        trips: tripIds.length,
        requests: requestIds.length,
        ...counts.rows[0],
      };

      if (dryRun) {
        await client.query("ROLLBACK");
        process.stdout.write(`\nDry run — nothing deleted.\n${JSON.stringify(summary, null, 2)}\n`);
      } else {
        // Dependency order: notifications (not an FK, so clear first to avoid
        // dangling inbox rows), then evidence, then disputes, then requests,
        // then the trips themselves. Every ride FK is ON DELETE RESTRICT.
        //
        // `commute_templates` is deliberately untouched: a template is a reusable
        // definition the driver may still be publishing from, not history.
        await client.query(
          "DELETE FROM in_app_notifications WHERE resource_id = ANY($1::uuid[]) OR resource_id = ANY($2::uuid[])",
          [requestIds, tripIds],
        );
        await client.query("DELETE FROM trip_no_show_evidence WHERE ride_request_id = ANY($1::uuid[])", [requestIds]);
        await client.query("DELETE FROM trip_disputes WHERE ride_request_id = ANY($1::uuid[])", [requestIds]);
        await client.query("DELETE FROM ride_requests WHERE id = ANY($1::uuid[])", [requestIds]);
        await client.query("DELETE FROM trip_occurrences WHERE id = ANY($1::uuid[])", [tripIds]);
        await client.query("COMMIT");
        process.stdout.write(`\nDeleted.\n${JSON.stringify(summary, null, 2)}\n`);

        const remaining = await client.query(ELIGIBLE_TRIPS, [retentionDays, limit]);
        if (remaining.rowCount === limit) {
          process.stdout.write(
            `\nThere is more eligible history than one batch removes. Run this again to continue, ` +
              `or raise --limit (max 10000).\n`,
          );
        }
      }
    }

    // Report what the rules declined to touch, so a low count is explainable.
    const skipped = await client.query(
      `SELECT
         (SELECT count(*)::int FROM trip_occurrences o
           WHERE o.status IN ('COMPLETED','CANCELLED')
             AND o.trip_date < (now() - ($1::int * interval '1 day'))::date
             AND EXISTS (SELECT 1 FROM safety_reports r WHERE r.trip_occurrence_id = o.id)) AS held_for_reports,
         (SELECT count(*)::int FROM trip_occurrences o
           WHERE o.status = 'OPEN'
             AND o.trip_date < (now() - ($1::int * interval '1 day'))::date) AS unsettled_trips,
         (SELECT count(*)::int FROM ride_requests rr
            JOIN trip_occurrences o ON o.id = rr.trip_occurrence_id
           WHERE rr.status IN ('REQUESTED','ACCEPTED')
             AND o.trip_date < (now() - ($1::int * interval '1 day'))::date) AS open_requests`,
      [retentionDays],
    );
    process.stdout.write(
      `\nHeld back (not deleted, by rule):\n${JSON.stringify(skipped.rows[0], null, 2)}\n` +
        "  held_for_reports: a safety report references the trip, so it is kept regardless of age.\n" +
        "  unsettled_trips / open_requests: still an open commitment, never pruned.\n",
    );
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
