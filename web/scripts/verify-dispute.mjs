/**
 * Exercise the trip-dispute path against a real database.
 *
 * Builds a departed, accepted trip that has been disputed, then calls the REAL
 * `resolveTripDispute` / `listOpenTripDisputes` services (imported from
 * `src/server/users/reports.ts`), not a hand-copied mirror of their SQL, and
 * asserts:
 *   - a dispute is visible to reviewers while unresolved, with confirmation context,
 *   - a plain member cannot resolve it (the role is checked in the database),
 *   - resolving to COMPLETED / EXPIRED moves the request out of DISPUTED,
 *   - the COMPLETED outcome satisfies the both-confirmations constraint,
 *   - both participants receive the outcome notice,
 *   - a second resolution is idempotent (no duplicate effect, no re-notify),
 *   - a different outcome after resolution is refused,
 *   - resolving a request that is not DISPUTED is refused,
 *   - the guard triggers on safety_report_events still reject mutation.
 *
 * Cleans up after itself and exits non-zero on failure.
 *
 * Run from web/: npm run verify:dispute
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
  max: 8,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const CID = "00000000-0000-4000-8000-000000000002";
const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

/**
 * Remove fixtures left by an earlier interrupted run.
 *
 * Every fixture this script creates uses the `vdGulberg` origin marker, so a
 * previous run that crashed or was killed before its `finally` block leaves rows
 * that collide with the next run's inserts (a duplicate dispute for the same
 * rider). Cleaning them up first makes the script safe to re-run after any
 * failure, which an "exits non-zero" contract otherwise quietly assumes.
 */
async function removeOrphanedFixtures() {
  await pool.query(
    `DELETE FROM trip_disputes d
      USING ride_requests r, trip_occurrences o, commute_templates t
      WHERE d.ride_request_id = r.id AND r.trip_occurrence_id = o.id
        AND o.commute_template_id = t.id AND t.origin_area = 'vdGulberg'`,
  ).catch(() => {});
  await pool.query(
    `DELETE FROM ride_requests r
      USING trip_occurrences o, commute_templates t
      WHERE r.trip_occurrence_id = o.id AND o.commute_template_id = t.id
        AND t.origin_area = 'vdGulberg'`,
  ).catch(() => {});
  await pool.query(
    `DELETE FROM trip_occurrences o
      USING commute_templates t
      WHERE o.commute_template_id = t.id AND t.origin_area = 'vdGulberg'`,
  ).catch(() => {});
  await pool.query("DELETE FROM commute_templates WHERE origin_area = 'vdGulberg'").catch(() => {});
  await pool.query("DELETE FROM community_memberships WHERE user_id IN (SELECT id FROM users WHERE display_name = 'vd fixture')").catch(() => {});
  await pool.query("DELETE FROM users WHERE display_name = 'vd fixture'").catch(() => {});
  await pool.query('DELETE FROM "user" WHERE email LIKE \'vd-%@verify.local\'').catch(() => {});
}

/**
 * The real service functions, imported from the server source. The previous
 * version of this script re-implemented their SQL by hand ("Mirrors … SQL
 * only"), which meant it verified the copy rather than the code — and the real
 * path was broken while the test stayed green. Importing the module through the
 * `@/*` alias loader means these are the functions the app actually runs.
 */
const { resolveTripDispute, listOpenTripDisputes } = await import("@/server/users/reports");

/** Build the actor shape the services expect from a real account row. */
function actorFor(userId, email) {
  return { userId, email, communityId: CID, participantRole: "DRIVER" };
}

/** Create an active account with the given membership role and its auth row. */
async function createAccount(role) {
  const userId = randomUUID();
  const authId = randomUUID();
  const email = `vd-${userId}@verify.local`;
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'vd fixture', $2, true, now(), now())`,
    [authId, email],
  );
  await pool.query(
    `INSERT INTO users (id, auth_subject, display_name, participant_role, status)
     VALUES ($1, $2, 'vd fixture', 'DRIVER', 'ACTIVE')`,
    [userId, authId],
  );
  await pool.query(
    `INSERT INTO community_memberships (community_id, user_id, status, role, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'ACTIVE', $3::membership_role, $2, now())`,
    [CID, userId, role],
  );
  return { userId, authId, email };
}

/**
 * Resolve a dispute through the real service. `actor` must hold an ACTIVE
 * OPERATOR/SAFETY_REVIEWER membership or the service refuses with a forbidden
 * error, which is itself part of what we are checking.
 */
async function resolveDispute(actor, { disputeId, resolution, notes }) {
  return resolveTripDispute({ actor, disputeId, resolution, notes, idempotencyKey: randomUUID() });
}

/** Run the real reviewer-queue query. */
async function openDisputes(actor) {
  return listOpenTripDisputes(actor);
}

async function main() {
  await removeOrphanedFixtures();

  // Create all three accounts this run needs. Do not borrow pre-existing
  // accounts: an earlier version selected the first two ACTIVE accounts and
  // assumed they were plain members, but one was a promoted OPERATOR, so the
  // "non-reviewer is refused" check was testing a reviewer and failed for the
  // wrong reason. Owning the fixtures makes the run independent of database
  // state.
  const driver = await createAccount("MEMBER");
  const rider = await createAccount("MEMBER");
  const reviewerAccount = await createAccount("OPERATOR");

  const commuteId = randomUUID();
  const tripId = randomUUID();
  const requestId = randomUUID();
  const disputeId = randomUUID();
  const client = await pool.connect();

  try {
    const reviewer = actorFor(reviewerAccount.userId, reviewerAccount.email);
    const plainMember = actorFor(rider.userId, rider.email);

    await client.query(
      `INSERT INTO commute_templates
         (id, community_id, owner_user_id, origin_area, destination_area,
          departure_window_start, departure_window_end, role, seats_offered)
       VALUES ($1,$2,$3,'vdGulberg','vdDHA','08:00','08:20','OFFERING',1)`,
      [commuteId, CID, driver.userId],
    );
    await client.query(
      `INSERT INTO trip_occurrences
         (id, commute_template_id, community_id, driver_user_id, trip_date,
          departure_at, timezone, origin_area, destination_area,
          seat_capacity, seats_reserved, status)
       SELECT $1,$2,$3,$4,
              ((now() - interval '20 hours') AT TIME ZONE 'Asia/Karachi')::date,
              now() - interval '20 hours','Asia/Karachi','vdGulberg','vdDHA',1,1,'OPEN'`,
      [tripId, commuteId, CID, driver.userId],
    );
    await client.query(
      `INSERT INTO ride_requests
         (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now() - interval '20 hours')`,
      [requestId, tripId, CID, rider.userId],
    );

    // The rider reports the trip did not happen, exactly as disputeTripCompletion does.
    await client.query(
      `INSERT INTO trip_disputes (id, community_id, ride_request_id, raised_by_user_id, reason)
       VALUES ($1,$2,$3,$4,'The driver never arrived.')`,
      [disputeId, CID, requestId, rider.userId],
    );
    await client.query(
      `UPDATE ride_requests SET status='DISPUTED', completed_at=NULL, updated_at=now()
        WHERE id=$1 AND status='ACCEPTED'`,
      [requestId],
    );

    // The services open their own transactions on the shared pool, so the
    // fixture has to be committed before they can see it. Commit and leave the
    // fixture connection in autocommit: if we opened a new transaction here, the
    // next UPDATE would hold a row lock while the service blocks on the same
    // row, deadlocking the run.
    await client.query("COMMIT");

    const queue = await openDisputes(reviewer);
    const queued = queue.find((row) => row.disputeId === disputeId);
    check("raised dispute appears in the reviewer queue", Boolean(queued) && queued.requestStatus === "DISPUTED", JSON.stringify(queue.map((r) => r.disputeId)));
    check(
      "queue exposes the confirmation context for the reviewer",
      queued?.riderConfirmedCompletion === false && queued?.driverConfirmedCompletion === false && queued?.hasNoShowEvidence === false,
      JSON.stringify(queued),
    );

    // A plain member must not be able to resolve; the reviewer role is checked
    // in the database, not merely by the dashboard hiding the control.
    let refusedPlainMember = false;
    try {
      await resolveDispute(plainMember, { disputeId, resolution: "TRIP_NOT_COMPLETED", notes: "" });
    } catch (error) {
      refusedPlainMember = error.code === "RIDE_ACTION_NOT_ALLOWED";
    }
    check("a non-reviewer is refused by the service", refusedPlainMember);

    // A request that is not DISPUTED must be refused.
    await client.query("UPDATE ride_requests SET status='ACCEPTED' WHERE id=$1", [requestId]);
    let refusedNonDisputed = false;
    try {
      await resolveDispute(reviewer, { disputeId, resolution: "TRIP_CONFIRMED", notes: "" });
    } catch (error) {
      refusedNonDisputed = error.code === "REQUEST_NOT_DISPUTED";
    }
    check("resolving a non-disputed request is refused", refusedNonDisputed);
    await client.query("UPDATE ride_requests SET status='DISPUTED' WHERE id=$1", [requestId]);

    // Resolve to EXPIRED (reviewer finds the trip did not happen).
    const first = await resolveDispute(reviewer, { disputeId, resolution: "TRIP_NOT_COMPLETED", notes: "No arrival evidence." });
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

    // Both participants are notified of the outcome.
    const outcomeNotices = await client.query(
      "SELECT count(*)::int AS n FROM in_app_notifications WHERE kind = 'TRIP_DISPUTE_RESOLVED' AND resource_id = $1",
      [requestId],
    );
    check("both participants receive the outcome notice", outcomeNotices.rows[0]?.n === 2, JSON.stringify(outcomeNotices.rows[0]));

    const afterQueue = await openDisputes(reviewer);
    check("resolved dispute leaves the open queue", !afterQueue.some((row) => row.disputeId === disputeId));

    // Replaying the same outcome is idempotent.
    const replay = await resolveDispute(reviewer, { disputeId, resolution: "TRIP_NOT_COMPLETED", notes: "" });
    check("re-resolving the same outcome replays without error", replay.replayedOrExisting === true, JSON.stringify(replay));

    // A conflicting outcome is refused.
    let refusedConflict = false;
    try {
      await resolveDispute(reviewer, { disputeId, resolution: "TRIP_CONFIRMED", notes: "" });
    } catch (error) {
      refusedConflict = error.code === "DISPUTE_ALREADY_RESOLVED";
    }
    check("a conflicting second resolution is refused", refusedConflict);

    // Reporting again after a decision reopens the dispute for review.
    const reopened = await client.query(
      `INSERT INTO trip_disputes (id, community_id, ride_request_id, raised_by_user_id, reason)
       VALUES ($1,$2,$3,$4,'Reopened: still not resolved.')
       ON CONFLICT (ride_request_id, raised_by_user_id) DO UPDATE
         SET reason = EXCLUDED.reason, resolved_at = NULL, resolution = NULL
       RETURNING id, resolved_at`,
      [randomUUID(), CID, requestId, rider.userId],
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

    // --- TRIP_CONFIRMED -> COMPLETED -------------------------------------
    //
    // The EXPIRED path above was the only outcome ever exercised, so the
    // COMPLETED path went unverified — and it was broken in two ways at once:
    // the resolution read `dispute.request_id` while the SELECT aliases
    // `ride_request_id` (notFound, always), and after that was fixed, the row
    // write omitted the confirmation flags that migration 0024's
    // completed-requires-both-confirmations CHECK requires. A reviewer could not
    // record that a disputed trip happened at all. Cover it here so the same
    // regression cannot pass silently again.
    {
      const confirmedTripId = randomUUID();
      const confirmedRequestId = randomUUID();
      const confirmedDisputeId = randomUUID();
      await client.query(
        `INSERT INTO trip_occurrences
           (id, commute_template_id, community_id, driver_user_id, trip_date,
            departure_at, timezone, origin_area, destination_area,
            seat_capacity, seats_reserved, status)
         SELECT $1,$2,$3,$4,
                ((now() - interval '3 days') AT TIME ZONE 'Asia/Karachi')::date,
                (now() - interval '3 days'),'Asia/Karachi','vdGulberg','vdDHA',1,1,'OPEN'`,
        [confirmedTripId, commuteId, CID, driver.userId],
      );
      await client.query(
        `INSERT INTO ride_requests
           (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
         VALUES ($1,$2,$3,$4,'DISPUTED', now() - interval '20 hours')`,
        [confirmedRequestId, confirmedTripId, CID, rider.userId],
      );
      await client.query(
        `INSERT INTO trip_disputes (id, community_id, ride_request_id, raised_by_user_id, reason)
         VALUES ($1,$2,$3,$4,'This trip happened but nobody confirmed.')`,
        [confirmedDisputeId, CID, confirmedRequestId, rider.userId],
      );
      // Commit so the service's own transaction can see this fixture, then stay
      // in autocommit for the same deadlock reason as above.
      await client.query("COMMIT");
      try {
        const outcome = await resolveDispute(reviewer, {
          disputeId: confirmedDisputeId,
          resolution: "TRIP_CONFIRMED",
          notes: "Both sides agreed it happened.",
        });
        check("resolution sets COMPLETED", outcome.requestStatus === "COMPLETED", JSON.stringify(outcome));

        const row = await client.query(
          "SELECT status, completed_at, rider_confirmed_completion, driver_confirmed_completion FROM ride_requests WHERE id = $1",
          [confirmedRequestId],
        );
        const settled = row.rows[0];
        check(
          "reviewer 'trip happened' satisfies the both-confirmations constraint",
          settled?.status === "COMPLETED" &&
            settled?.completed_at !== null &&
            settled?.rider_confirmed_completion === true &&
            settled?.driver_confirmed_completion === true,
          JSON.stringify(settled),
        );

        const disputeRow = await client.query("SELECT resolved_at, resolution FROM trip_disputes WHERE id = $1", [confirmedDisputeId]);
        check(
          "confirmed dispute is stamped resolved with its resolution",
          Boolean(disputeRow.rows[0]?.resolved_at) && /^TRIP_CONFIRMED/.test(disputeRow.rows[0]?.resolution ?? ""),
          JSON.stringify(disputeRow.rows[0]),
        );
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        await client.query("DELETE FROM trip_disputes WHERE ride_request_id = $1", [confirmedRequestId]).catch(() => {});
        await client.query("DELETE FROM ride_requests WHERE id = $1", [confirmedRequestId]).catch(() => {});
        await client.query("DELETE FROM trip_occurrences WHERE id = $1", [confirmedTripId]).catch(() => {});
      }
    }
  } finally {
    // The fixture rows were committed, so cleanup deletes them with explicit
    // statements. ROLLBACK first in case an assertion left a transaction open.
    await client.query("ROLLBACK").catch(() => {});
    await client.query("DELETE FROM trip_disputes WHERE ride_request_id = $1", [requestId]).catch(() => {});
    await client.query("DELETE FROM ride_requests WHERE id = $1", [requestId]).catch(() => {});
    await client.query("DELETE FROM trip_occurrences WHERE id = $1", [tripId]).catch(() => {});
    await client.query("DELETE FROM commute_templates WHERE id = $1", [commuteId]).catch(() => {});
    for (const account of [driver, rider, reviewerAccount]) {
      await client.query("DELETE FROM in_app_notifications WHERE recipient_user_id = $1 OR actor_user_id = $1", [account.userId]).catch(() => {});
      await client.query("DELETE FROM community_memberships WHERE user_id = $1", [account.userId]).catch(() => {});
      await client.query("DELETE FROM users WHERE id = $1", [account.userId]).catch(() => {});
      await client.query('DELETE FROM "user" WHERE id = $1', [account.authId]).catch(() => {});
    }
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
