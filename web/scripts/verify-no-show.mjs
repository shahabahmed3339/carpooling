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

/** Create an active account with an auth row; returns its ids. */
async function createAccount() {
  const userId = randomUUID();
  const authId = randomUUID();
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'ns fixture', $2, true, now(), now())`,
    [authId, `ns-${userId}@verify.local`],
  );
  await pool.query(
    `INSERT INTO users (id, auth_subject, display_name, participant_role, status)
     VALUES ($1, $2, 'ns fixture', 'DRIVER', 'ACTIVE')`,
    [userId, authId],
  );
  await pool.query(
    `INSERT INTO community_memberships (community_id, user_id, status, role, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'ACTIVE', 'MEMBER', $2, now())`,
    [CID, userId],
  );
  return { userId, authId };
}

/** Remove fixtures left by an earlier interrupted run (marker: `nsGulberg`). */
async function removeOrphanedFixtures() {
  await pool.query(
    `DELETE FROM trip_no_show_evidence WHERE ride_request_id IN (
       SELECT r.id FROM ride_requests r
        JOIN trip_occurrences o ON o.id = r.trip_occurrence_id
       WHERE o.origin_area = 'nsGulberg')`,
  ).catch(() => {});
  await pool.query(
    `DELETE FROM ride_requests WHERE trip_occurrence_id IN (
       SELECT id FROM trip_occurrences WHERE origin_area = 'nsGulberg')`,
  ).catch(() => {});
  await pool.query("DELETE FROM trip_occurrences WHERE origin_area = 'nsGulberg'").catch(() => {});
  await pool.query("DELETE FROM commute_templates WHERE origin_area = 'nsGulberg'").catch(() => {});
  await pool.query("DELETE FROM community_memberships WHERE user_id IN (SELECT id FROM users WHERE display_name = 'ns fixture')").catch(() => {});
  await pool.query("DELETE FROM users WHERE display_name = 'ns fixture'").catch(() => {});
  await pool.query(`DELETE FROM "user" WHERE email LIKE 'ns-%@verify.local'`).catch(() => {});
}

/**
 * The real sweep, imported from the server source. The previous version mirrored
 * its SQL ("mirroring src/server/rides/completion.ts") and was kept in sync only
 * by hand — the same drift risk that let a broken dispute path pass its own test.
 * Importing the module means this exercises the sweep the app actually runs.
 */
const { expireStaleTrips } = await import("@/server/rides/completion");

/** Run the real sweep. It opens its own transaction, so no fixture may be held. */
async function runSweep() {
  return expireStaleTrips();
}

async function main() {
  await removeOrphanedFixtures();

  // Own the driver/rider accounts instead of borrowing the first two ACTIVE rows:
  // a borrowed account can be a reviewer, which silently changes what the test
  // measures. All writes go through `pool` in autocommit because the real sweep
  // opens its own transaction and must not be blocked by a held fixture one.
  const driver = await createAccount();
  const rider = await createAccount();

  const commuteId = randomUUID();
  const tripId = randomUUID();
  const requestId = randomUUID();
  const client = pool;

  try {
    await client.query(
      `INSERT INTO commute_templates
         (id, community_id, owner_user_id, origin_area, destination_area,
          departure_window_start, departure_window_end, role, seats_offered)
       VALUES ($1,$2,$3,'nsGulberg','nsDHA','08:00','08:20','OFFERING',1)`,
      [commuteId, CID, driver.userId],
    );
    await client.query(
      `INSERT INTO trip_occurrences
         (id, commute_template_id, community_id, driver_user_id, trip_date,
          departure_at, timezone, origin_area, destination_area,
          seat_capacity, seats_reserved, status)
       VALUES ($1,$2,$3,$4,(now() AT TIME ZONE 'Asia/Karachi')::date - 2,
               now() - interval '48 hours','Asia/Karachi','nsGulberg','nsDHA',1,1,'OPEN')`,
      [tripId, commuteId, CID, driver.userId],
    );
    await client.query(
      `INSERT INTO ride_requests
         (id, trip_occurrence_id, community_id, rider_user_id, status,
          accepted_at, rider_confirmed_completion, driver_confirmed_completion)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now() - interval '48 hours', true, false)`,
      [requestId, tripId, CID, rider.userId],
    );

    const sweep = await runSweep();
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

    const second = await runSweep();
    const after = await client.query(
      "SELECT count(*)::int AS n FROM trip_no_show_evidence WHERE ride_request_id = $1",
      [requestId],
    );
    check("re-running does not duplicate evidence", after.rows[0]?.n === 1, JSON.stringify(after.rows));
    check("second sweep records no new evidence", second.noShowEvidenceRecorded === 0, JSON.stringify(second));
  } finally {
    await pool.query("DELETE FROM trip_no_show_evidence WHERE ride_request_id = $1", [requestId]).catch(() => {});
    await pool.query("DELETE FROM ride_requests WHERE id = $1", [requestId]).catch(() => {});
    await pool.query("DELETE FROM trip_occurrences WHERE id = $1", [tripId]).catch(() => {});
    await pool.query("DELETE FROM commute_templates WHERE id = $1", [commuteId]).catch(() => {});
    for (const account of [driver, rider]) {
      await pool.query("DELETE FROM community_memberships WHERE user_id = $1", [account.userId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [account.userId]).catch(() => {});
      await pool.query('DELETE FROM "user" WHERE id = $1', [account.authId]).catch(() => {});
    }
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
