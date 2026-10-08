/**
 * Exercise the no-show evidence path against a real database.
 *
 * Builds a departed trip with only the rider confirmed, runs the same guarded
 * statements the application uses, and asserts the evidence recorded matches the
 * flags that were actually set. Cleans up after itself, exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-no-show.mjs
 */
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new Pool({
  connectionString: url.toString(),
  max: 2,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const CID = "00000000-0000-4000-8000-000000000002";
const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

/**
 * The canonical sweep, mirroring src/server/rides/completion.ts. Kept in sync by
 * the invariant checker: if these diverge, evidence stops matching its request.
 */
async function runSweep(client) {
  const expired = await client.query(
    `UPDATE ride_requests r
        SET status = 'EXPIRED', updated_at = now()
       FROM trip_occurrences o
      WHERE o.id = r.trip_occurrence_id
        AND r.status = 'ACCEPTED'
        AND o.status = 'OPEN'
        AND o.departure_at < now() - (SELECT completion_window FROM trip_policy WHERE id = true)
      RETURNING r.id, r.community_id,
                r.rider_confirmed_completion, r.driver_confirmed_completion,
                o.departure_at AS departed_at`,
  );

  let recorded = 0;
  for (const row of expired.rows) {
    const outcome = row.rider_confirmed_completion && row.driver_confirmed_completion
      ? "BOTH_CONFIRMED"
      : row.rider_confirmed_completion
        ? "DRIVER_UNCONFIRMED"
        : row.driver_confirmed_completion
          ? "RIDER_UNCONFIRMED"
          : "NEITHER_CONFIRMED";
    const inserted = await client.query(
      `INSERT INTO trip_no_show_evidence
         (ride_request_id, community_id, outcome, rider_confirmed, driver_confirmed, departed_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (ride_request_id) DO NOTHING`,
      [row.id, row.community_id, outcome, row.rider_confirmed_completion, row.driver_confirmed_completion, row.departed_at],
    );
    recorded += inserted.rowCount ?? 0;
  }

  const abandoned = await client.query(
    `UPDATE ride_requests r
        SET status = 'EXPIRED', updated_at = now()
       FROM trip_occurrences o
      WHERE o.id = r.trip_occurrence_id
        AND r.status = 'REQUESTED'
        AND o.status <> 'CANCELLED'
        AND o.departure_at <= now()`,
  );

  const trips = await client.query(
    `UPDATE trip_occurrences o
        SET status = 'COMPLETED', seats_reserved = 0, updated_at = now()
      WHERE o.status = 'OPEN'
        AND o.departure_at < now()
        AND NOT EXISTS (
          SELECT 1 FROM ride_requests r
           WHERE r.trip_occurrence_id = o.id AND r.status = 'ACCEPTED'
        )`,
  );

  return {
    requestsExpired: (expired.rowCount ?? 0) + (abandoned.rowCount ?? 0),
    tripsCompleted: trips.rowCount ?? 0,
    noShowEvidenceRecorded: recorded,
  };
}

async function main() {
  const accounts = await pool.query(
    `SELECT u.id FROM users u
      JOIN community_memberships m ON m.user_id = u.id AND m.community_id = $1
     WHERE u.status = 'ACTIVE' AND m.status = 'ACTIVE' LIMIT 2`,
    [CID],
  );
  if (accounts.rowCount < 2) throw new Error("need two active accounts to build a fixture");
  const [driver, rider] = accounts.rows;

  const commuteId = randomUUID();
  const tripId = randomUUID();
  const requestId = randomUUID();
  const client = await pool.connect();

  try {
    await client.query(
      `INSERT INTO commute_templates
         (id, community_id, owner_user_id, origin_area, destination_area,
          departure_window_start, departure_window_end, role, seats_offered)
       VALUES ($1,$2,$3,'nsGulberg','nsDHA','08:00','08:20','OFFERING',1)`,
      [commuteId, CID, driver.id],
    );
    await client.query(
      `INSERT INTO trip_occurrences
         (id, commute_template_id, community_id, driver_user_id, trip_date,
          departure_at, timezone, origin_area, destination_area,
          seat_capacity, seats_reserved, status)
       VALUES ($1,$2,$3,$4,(now() AT TIME ZONE 'Asia/Karachi')::date - 2,
               now() - interval '48 hours','Asia/Karachi','nsGulberg','nsDHA',1,1,'OPEN')`,
      [tripId, commuteId, CID, driver.id],
    );
    await client.query(
      `INSERT INTO ride_requests
         (id, trip_occurrence_id, community_id, rider_user_id, status,
          accepted_at, rider_confirmed_completion, driver_confirmed_completion)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now() - interval '48 hours', true, false)`,
      [requestId, tripId, CID, rider.id],
    );

    const sweep = await runSweep(client);
    check("sweep expired at least one request", sweep.requestsExpired >= 1, JSON.stringify(sweep));
    check("sweep recorded evidence", sweep.noShowEvidenceRecorded >= 1, JSON.stringify(sweep));

    const evidence = await client.query(
      "SELECT outcome, rider_confirmed, driver_confirmed FROM trip_no_show_evidence WHERE ride_request_id = $1",
      [requestId],
    );
    check("evidence row written", evidence.rowCount === 1, JSON.stringify(evidence.rows));
    check(
      "outcome is DRIVER_UNCONFIRMED",
      evidence.rows[0]?.outcome === "DRIVER_UNCONFIRMED",
      JSON.stringify(evidence.rows[0]),
    );
    check(
      "stored flags match what was set",
      evidence.rows[0]?.rider_confirmed === true && evidence.rows[0]?.driver_confirmed === false,
      JSON.stringify(evidence.rows[0]),
    );

    const request = await client.query("SELECT status FROM ride_requests WHERE id = $1", [requestId]);
    check("request is EXPIRED", request.rows[0]?.status === "EXPIRED", JSON.stringify(request.rows));

    const trip = await client.query("SELECT status, seats_reserved FROM trip_occurrences WHERE id = $1", [tripId]);
    check(
      "trip closed with capacity settled",
      trip.rows[0]?.status === "COMPLETED" && trip.rows[0]?.seats_reserved === 0,
      JSON.stringify(trip.rows[0]),
    );

    const second = await runSweep(client);
    const after = await client.query(
      "SELECT count(*)::int AS n FROM trip_no_show_evidence WHERE ride_request_id = $1",
      [requestId],
    );
    check("re-running does not duplicate evidence", after.rows[0]?.n === 1, JSON.stringify(after.rows));
    check("second sweep records no new evidence", second.noShowEvidenceRecorded === 0, JSON.stringify(second));
  } finally {
    await client.query("DELETE FROM trip_no_show_evidence WHERE ride_request_id = $1", [requestId]).catch(() => {});
    await client.query("DELETE FROM ride_requests WHERE id = $1", [requestId]).catch(() => {});
    await client.query("DELETE FROM trip_occurrences WHERE id = $1", [tripId]).catch(() => {});
    await client.query("DELETE FROM commute_templates WHERE id = $1", [commuteId]).catch(() => {});
    client.release();
  }

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  -> ${r.detail}`}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("verify-no-show failed:", error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
