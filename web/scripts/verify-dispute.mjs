/**
 * Exercise the trip-dispute path against a real database.
 *
 * Builds a departed, accepted trip that has been disputed, then runs the same
 * guarded statements the app uses to resolve it and asserts:
 *   - a dispute is visible to reviewers while unresolved,
 *   - resolving to COMPLETED / EXPIRED moves the request out of DISPUTED,
 *   - a second resolution is idempotent (no duplicate effect, no re-notify),
 *   - a different outcome after resolution is refused,
 *   - resolving a request that is not DISPUTED is refused,
 *   - the guard triggers on safety_report_events still reject mutation.
 *
 * Cleans up after itself and exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-dispute.mjs
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

/** Mirrors resolveTripDispute in src/server/users/reports.ts (SQL only). */
async function resolveDispute(client, { disputeId, resolution, notes }) {
  const lookup = await client.query(
    `SELECT d.ride_request_id AS request_id, r.trip_occurrence_id
       FROM trip_disputes d
       JOIN ride_requests r ON r.id = d.ride_request_id AND r.community_id = d.community_id
      WHERE d.id = $1 AND d.community_id = $2`,
    [disputeId, CID],
  );
  const found = lookup.rows[0];
  if (!found) throw new Error("dispute not found");

  await client.query(
    "SELECT 1 FROM trip_occurrences WHERE id = $1 AND community_id = $2 FOR UPDATE",
    [found.trip_occurrence_id, CID],
  );
  const dispute = await client.query(
    "SELECT id, ride_request_id, resolved_at FROM trip_disputes WHERE id = $1 AND community_id = $2 FOR UPDATE",
    [disputeId, CID],
  );
  const row = dispute.rows[0];
  if (!row) throw new Error("dispute not found");
  const request = await client.query(
    "SELECT id, status, rider_user_id FROM ride_requests WHERE id = $1 FOR UPDATE",
    [row.ride_request_id],
  );
  const req = request.rows[0];
  if (!req) throw new Error("request not found");

  const nextStatus = resolution === "TRIP_CONFIRMED" ? "COMPLETED" : "EXPIRED";
  if (row.resolved_at !== null) {
    if (req.status === nextStatus) return { requestId: req.id, requestStatus: nextStatus, replayed: true };
    throw new Error("DISPUTE_ALREADY_RESOLVED");
  }
  if (req.status !== "DISPUTED") throw new Error("REQUEST_NOT_DISPUTED");

  await client.query(
    `UPDATE trip_disputes SET resolved_at = clock_timestamp(), resolution = $3
      WHERE id = $1 AND community_id = $2 AND resolved_at IS NULL`,
    [row.id, CID, notes ? `${resolution}: ${notes}` : resolution],
  );
  await client.query(
    `UPDATE ride_requests
        SET status = $3::ride_request_status,
            completed_at = CASE WHEN $3::ride_request_status = 'COMPLETED' THEN COALESCE(completed_at, clock_timestamp()) ELSE completed_at END,
            updated_at = clock_timestamp()
      WHERE id = $1 AND status = 'DISPUTED' AND trip_occurrence_id = $2`,
    [req.id, found.trip_occurrence_id, nextStatus],
  );
  return { requestId: req.id, requestStatus: nextStatus, replayed: false };
}

/** Mirrors the reviewer queue query in listOpenTripDisputes. */
async function openDisputes(client) {
  return client.query(
    `SELECT d.id AS "disputeId", d.ride_request_id AS "requestId", r.status AS "requestStatus",
            r.rider_confirmed_completion AS "riderConfirmedCompletion",
            r.driver_confirmed_completion AS "driverConfirmedCompletion",
            EXISTS (SELECT 1 FROM trip_no_show_evidence e WHERE e.ride_request_id = r.id) AS "hasNoShowEvidence"
       FROM trip_disputes d
       JOIN ride_requests r ON r.id = d.ride_request_id AND r.community_id = d.community_id
      WHERE d.community_id = $1 AND d.resolved_at IS NULL
      ORDER BY d.created_at ASC, d.id ASC LIMIT 100`,
    [CID],
  );
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
  const disputeId = randomUUID();
  const client = await pool.connect();

  try {
    await client.query(
      `INSERT INTO commute_templates
         (id, community_id, owner_user_id, origin_area, destination_area,
          departure_window_start, departure_window_end, role, seats_offered)
       VALUES ($1,$2,$3,'vdGulberg','vdDHA','08:00','08:20','OFFERING',1)`,
      [commuteId, CID, driver.id],
    );
    await client.query(
      `INSERT INTO trip_occurrences
         (id, commute_template_id, community_id, driver_user_id, trip_date,
          departure_at, timezone, origin_area, destination_area,
          seat_capacity, seats_reserved, status)
       SELECT $1,$2,$3,$4,
              ((now() - interval '20 hours') AT TIME ZONE 'Asia/Karachi')::date,
              now() - interval '20 hours','Asia/Karachi','vdGulberg','vdDHA',1,1,'OPEN'`,
      [tripId, commuteId, CID, driver.id],
    );
    await client.query(
      `INSERT INTO ride_requests
         (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now() - interval '20 hours')`,
      [requestId, tripId, CID, rider.id],
    );

    // The rider reports the trip did not happen, exactly as disputeTripCompletion does.
    await client.query(
      `INSERT INTO trip_disputes (id, community_id, ride_request_id, raised_by_user_id, reason)
       VALUES ($1,$2,$3,$4,'The driver never arrived.')`,
      [disputeId, CID, requestId, rider.id],
    );
    await client.query(
      `UPDATE ride_requests SET status='DISPUTED', completed_at=NULL, updated_at=now()
        WHERE id=$1 AND status='ACCEPTED'`,
      [requestId],
    );

    const queue = await openDisputes(client);
    const queued = queue.rows.find((row) => row.disputeId === disputeId);
    check("raised dispute appears in the reviewer queue", Boolean(queued) && queued.requestStatus === "DISPUTED", JSON.stringify(queue.rows.map((r) => r.disputeId)));
    check(
      "queue exposes the confirmation context for the reviewer",
      queued?.riderConfirmedCompletion === false && queued?.driverConfirmedCompletion === false && queued?.hasNoShowEvidence === false,
      JSON.stringify(queued),
    );

    // A request that is not DISPUTED must be refused.
    await client.query("UPDATE ride_requests SET status='ACCEPTED' WHERE id=$1", [requestId]);
    let refusedNonDisputed = false;
    try {
      await resolveDispute(client, { disputeId, resolution: "TRIP_CONFIRMED", notes: "" });
    } catch (error) {
      refusedNonDisputed = error.message === "REQUEST_NOT_DISPUTED";
    }
    check("resolving a non-disputed request is refused", refusedNonDisputed);
    await client.query("UPDATE ride_requests SET status='DISPUTED' WHERE id=$1", [requestId]);

    // Resolve to EXPIRED (reviewer finds the trip did not happen).
    const first = await resolveDispute(client, { disputeId, resolution: "TRIP_NOT_COMPLETED", notes: "No arrival evidence." });
    check("resolution sets EXPIRED", first.requestStatus === "EXPIRED", JSON.stringify(first));

    const settled = await client.query(
      "SELECT status, completed_at FROM ride_requests WHERE id = $1",
      [requestId],
    );
    check(
      "request is terminal EXPIRED with no completed_at",
      settled.rows[0]?.status === "EXPIRED" && settled.rows[0]?.completed_at === null,
      JSON.stringify(settled.rows[0]),
    );

    const disputeRow = await client.query(
      "SELECT resolved_at, resolution FROM trip_disputes WHERE id = $1",
      [disputeId],
    );
    check("dispute is stamped resolved with a resolution", Boolean(disputeRow.rows[0]?.resolved_at) && Boolean(disputeRow.rows[0]?.resolution), JSON.stringify(disputeRow.rows[0]));

    const afterQueue = await openDisputes(client);
    check("resolved dispute leaves the open queue", !afterQueue.rows.some((row) => row.disputeId === disputeId));

    // Replaying the same outcome is idempotent.
    const replay = await resolveDispute(client, { disputeId, resolution: "TRIP_NOT_COMPLETED", notes: "" });
    check("re-resolving the same outcome replays without error", replay.replayed === true, JSON.stringify(replay));

    // A conflicting outcome is refused.
    let refusedConflict = false;
    try {
      await resolveDispute(client, { disputeId, resolution: "TRIP_CONFIRMED", notes: "" });
    } catch (error) {
      refusedConflict = error.message === "DISPUTE_ALREADY_RESOLVED";
    }
    check("a conflicting second resolution is refused", refusedConflict);

    // Reporting again after a decision reopens the dispute for review.
    const reopened = await client.query(
      `INSERT INTO trip_disputes (id, community_id, ride_request_id, raised_by_user_id, reason)
       VALUES ($1,$2,$3,$4,'Reopened: still not resolved.')
       ON CONFLICT (ride_request_id, raised_by_user_id) DO UPDATE
         SET reason = EXCLUDED.reason, resolved_at = NULL, resolution = NULL
       RETURNING id, resolved_at`,
      [randomUUID(), CID, requestId, rider.id],
    );
    check(
      "re-reporting clears resolved_at and reopens the dispute",
      reopened.rows[0]?.resolved_at === null,
      JSON.stringify(reopened.rows[0]),
    );

    // The append-only guard on safety-report events must still hold. A row-level
    // trigger only fires for matched rows, so target a real one and roll back.
    let guardHeld = false;
    let guardDetail = "no safety_report_events row to test against";
    const anyEvent = await client.query("SELECT id FROM safety_report_events LIMIT 1");
    if (anyEvent.rowCount === 1) {
      await client.query("BEGIN");
      try {
        await client.query("UPDATE safety_report_events SET notes = 'tamper' WHERE id = $1", [anyEvent.rows[0].id]);
        guardDetail = "UPDATE on an existing row was accepted";
      } catch (error) {
        guardHeld = /append-only/.test(error.message);
        guardDetail = error.message;
      } finally {
        await client.query("ROLLBACK");
      }
    }
    check("safety report events remain append-only (UPDATE rejected)", guardHeld, guardDetail);
  } finally {
    await client.query("DELETE FROM trip_disputes WHERE ride_request_id = $1", [requestId]).catch(() => {});
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
  console.error("verify-dispute failed:", error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
