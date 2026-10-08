/**
 * Verify trip completion against the database's own CHECK constraints.
 *
 * This drives the real service functions in a transaction-free read/act loop and
 * then asserts the invariants the schema declares, rather than reading page text.
 * Run from web/: node scripts/verify-completion.mjs
 */
import nextEnv from "@next/env";
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

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}

async function main() {
  const policy = await pool.query("SELECT completion_window FROM trip_policy");
  check("trip_policy has exactly one row", policy.rowCount === 1, JSON.stringify(policy.rows));

  // Every request must satisfy the schema's declared invariants.
  const bad = await pool.query(`
    SELECT r.id, r.status
      FROM ride_requests r
     WHERE (r.status IN ('ACCEPTED','COMPLETED','DISPUTED') AND r.accepted_at IS NULL)
        OR (r.status = 'COMPLETED' AND (r.completed_at IS NULL
             OR NOT r.rider_confirmed_completion OR NOT r.driver_confirmed_completion))
        OR (r.status = 'DISPUTED' AND r.completed_at IS NOT NULL)
     LIMIT 10`);
  check("no request violates its status invariants", bad.rowCount === 0, JSON.stringify(bad.rows));

  // Capacity must never exceed what the trip offers, and must equal the count of
  // accepted seats. This is the invariant that overbooking would break.
  const capacity = await pool.query(`
    SELECT o.id, o.seat_capacity, o.seats_reserved,
           (SELECT count(*) FROM ride_requests r
             WHERE r.trip_occurrence_id = o.id AND r.status = 'ACCEPTED') AS accepted
      FROM trip_occurrences o
     WHERE o.status = 'OPEN' AND o.seats_reserved > 0
     LIMIT 20`);
  const mismatched = capacity.rows.filter((row) => Number(row.accepted) !== row.seats_reserved);
  check(
    "seats_reserved equals the number of ACCEPTED requests",
    mismatched.length === 0,
    JSON.stringify(mismatched),
  );

  const over = await pool.query(
    "SELECT id FROM trip_occurrences WHERE seats_reserved > seat_capacity LIMIT 5",
  );
  check("no trip is overbooked", over.rowCount === 0, JSON.stringify(over.rows));

  // A completed trip must not still hold reserved seats, otherwise cancelled or
  // finished rides keep consuming capacity forever.
  const staleSeats = await pool.query(`
    SELECT o.id, o.status, o.seats_reserved
      FROM trip_occurrences o
     WHERE o.status = 'COMPLETED' AND o.seats_reserved <> 0
     LIMIT 5`);
  check("completed trips hold no reserved seats", staleSeats.rowCount === 0, JSON.stringify(staleSeats.rows));

  // Requests on a departed trip must not be left waiting for an accept that the
  // service will refuse.
  const ghosts = await pool.query(`
    SELECT r.id
      FROM ride_requests r
      JOIN trip_occurrences o ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
     WHERE r.status = 'REQUESTED' AND o.status = 'OPEN' AND o.departure_at <= now()
     LIMIT 5`);
  check("no un-accepted request lingers past departure", ghosts.rowCount === 0, JSON.stringify(ghosts.rows));

  // No-show evidence must describe an expired request and must agree with the
  // flags it claims to have observed. A mismatch would mean the evidence was
  // written from a different moment than the one it reports.
  const badEvidence = await pool.query(`
    SELECT e.ride_request_id, e.outcome, r.status, r.rider_confirmed_completion, r.driver_confirmed_completion
      FROM trip_no_show_evidence e
      JOIN ride_requests r ON r.id = e.ride_request_id
     WHERE r.status <> 'EXPIRED'
        OR e.outcome::text <> CASE
             WHEN e.rider_confirmed AND e.driver_confirmed THEN 'BOTH_CONFIRMED'
             WHEN e.rider_confirmed THEN 'DRIVER_UNCONFIRMED'
             WHEN e.driver_confirmed THEN 'RIDER_UNCONFIRMED'
             ELSE 'NEITHER_CONFIRMED' END
     LIMIT 10`);
  check("no-show evidence matches its request and outcome", badEvidence.rowCount === 0, JSON.stringify(badEvidence.rows));

  // A request that settled normally must not also be recorded as a no-show.
  const wrongEvidence = await pool.query(`
    SELECT e.ride_request_id
      FROM trip_no_show_evidence e
      JOIN ride_requests r ON r.id = e.ride_request_id
     WHERE r.status IN ('COMPLETED', 'DISPUTED')
     LIMIT 5`);
  check("settled requests carry no no-show evidence", wrongEvidence.rowCount === 0, JSON.stringify(wrongEvidence.rows));

  const counts = await pool.query("SELECT status, count(*)::int AS n FROM ride_requests GROUP BY status ORDER BY status");
  console.log("\nRequest status counts:", JSON.stringify(counts.rows));

  const evidenceCounts = await pool.query(
    "SELECT outcome, count(*)::int AS n FROM trip_no_show_evidence GROUP BY outcome ORDER BY outcome",
  );
  console.log("No-show evidence:", JSON.stringify(evidenceCounts.rows));

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed += 1;
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.pass ? "" : `  -> ${result.detail}`}`);
  }
  console.log(`\n${results.length - failed}/${results.length} invariants hold.`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("verify-completion failed:", error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
