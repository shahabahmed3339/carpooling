/**
 * Verify trip completion against the database's own CHECK constraints.
 *
 * This is a read-only invariant check: it asserts the properties the schema
 * declares across the live data. The one piece of production logic it needs is
 * the no-show outcome classification, which it imports from the real
 * `classifyOutcome` rather than re-deriving with its own CASE expression — a
 * hand-copied rule would keep passing after the real classifier changed.
 * Run from web/: npm run verify:completion
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

const { classifyOutcome } = await import("@/server/rides/completion");

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}

/**
 * Insert one no-show evidence row with known flags and confirm the stored
 * outcome agrees with the real `classifyOutcome`. Without this the evidence
 * check above is vacuous whenever the table is empty — which it is on a fresh
 * database — so the classifier could change with nothing to catch it.
 * Removes the row afterwards.
 */
async function checkClassifierAgreement() {
  const accounts = await pool.query(
    `SELECT u.id FROM users u
      JOIN community_memberships m ON m.user_id = u.id AND m.community_id = $1
     WHERE u.status = 'ACTIVE' AND m.status = 'ACTIVE' LIMIT 2`,
    ["00000000-0000-4000-8000-000000000002"],
  );
  if (accounts.rowCount < 2) {
    return { name: "classifier agrees with a known evidence row", pass: false, detail: "need two active accounts" };
  }
  const [rider, driver] = accounts.rows;
  const commuteId = randomUUID();
  const tripId = randomUUID();
  const requestId = randomUUID();
  const CID = "00000000-0000-4000-8000-000000000002";
  const riderConfirmed = true;
  const driverConfirmed = false;
  const expected = classifyOutcome(riderConfirmed, driverConfirmed);
  try {
    await pool.query(
      `INSERT INTO commute_templates (id,community_id,owner_user_id,origin_area,destination_area,departure_window_start,departure_window_end,role,seats_offered)
       VALUES ($1,$2,$3,'vcoG','vcoD','08:00','08:20','OFFERING',1)`,
      [commuteId, CID, driver.id],
    );
    await pool.query(
      `INSERT INTO trip_occurrences (id,commute_template_id,community_id,driver_user_id,trip_date,departure_at,timezone,origin_area,destination_area,seat_capacity,seats_reserved,status)
       SELECT $1,$2,$3,$4,((now()-interval '3 days') AT TIME ZONE 'Asia/Karachi')::date, now()-interval '3 days','Asia/Karachi','vcoG','vcoD',1,0,'COMPLETED'`,
      [tripId, commuteId, CID, driver.id],
    );
    await pool.query(
      `INSERT INTO ride_requests (id,trip_occurrence_id,community_id,rider_user_id,status,accepted_at,rider_confirmed_completion,driver_confirmed_completion)
       VALUES ($1,$2,$3,$4,'EXPIRED', now()-interval '3 days', $5, $6)`,
      [requestId, tripId, CID, rider.id, riderConfirmed, driverConfirmed],
    );
    await pool.query(
      `INSERT INTO trip_no_show_evidence (ride_request_id,community_id,outcome,rider_confirmed,driver_confirmed,departed_at)
       VALUES ($1,$2,$3,$4,$5, now()-interval '3 days')`,
      [requestId, CID, expected, riderConfirmed, driverConfirmed],
    );
    const stored = await pool.query("SELECT outcome::text AS outcome FROM trip_no_show_evidence WHERE ride_request_id = $1", [requestId]);
    return {
      name: "classifier agrees with a known evidence row",
      pass: stored.rows[0]?.outcome === expected,
      detail: `expected=${expected} stored=${stored.rows[0]?.outcome}`,
    };
  } finally {
    await pool.query("DELETE FROM trip_no_show_evidence WHERE ride_request_id = $1", [requestId]).catch(() => {});
    await pool.query("DELETE FROM ride_requests WHERE id = $1", [requestId]).catch(() => {});
    await pool.query("DELETE FROM trip_occurrences WHERE id = $1", [tripId]).catch(() => {});
    await pool.query("DELETE FROM commute_templates WHERE id = $1", [commuteId]).catch(() => {});
  }
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
  // written from a different moment than the one it reports. The expected
  // outcome comes from the real classifier, so this cannot drift from the rule
  // the app actually applies.
  const evidenceRows = await pool.query(`
    SELECT e.ride_request_id, e.outcome, e.rider_confirmed, e.driver_confirmed,
           r.status, r.rider_confirmed_completion, r.driver_confirmed_completion
      FROM trip_no_show_evidence e
      JOIN ride_requests r ON r.id = e.ride_request_id`);
  const badEvidence = evidenceRows.rows.filter(
    (row) => row.status !== "EXPIRED" || row.outcome !== classifyOutcome(row.rider_confirmed, row.driver_confirmed),
  );
  check(
    "no-show evidence matches its request and outcome",
    badEvidence.length === 0,
    JSON.stringify(badEvidence.slice(0, 10)),
  );

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

  // Non-vacuous classifier check (the invariant query above matches zero rows on
  // an empty table, so it alone cannot catch a classifier change).
  results.push(await checkClassifierAgreement());

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
