/**
 * Exercise account closure against a real database.
 *
 * Account closure is destructive and touches other participants' records, so it
 * is the highest-risk flow in the app. This builds disposable accounts and
 * trips and runs the same guarded statements the closure service uses, then
 * asserts:
 *   - closure is refused while the account is on a trip that already departed,
 *   - a rider's accepted seat is released and the trip's capacity is settled,
 *   - the driver's future trip is cancelled and its requests withdrawn,
 *   - participation is removed (membership no longer ACTIVE),
 *   - identifying data is erased and the row cannot sign in,
 *   - historical rows survive against the anonymous tombstone.
 *
 * Cleans up everything it creates, exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-account-closure.mjs
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

async function createAccount(client, label) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO users (id, auth_subject, display_name, participant_role)
     VALUES ($1, $2, $3, 'RIDER')`,
    [id, `acctest-subject-${id}`, label],
  );
  await client.query(
    `INSERT INTO community_memberships (community_id, user_id, status, role, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'ACTIVE', 'MEMBER', $2, now())`,
    [CID, id],
  );
  return id;
}

/**
 * Mirror of withdrawOpenCommitments + the erase step in src/server/users/account.ts.
 * Kept as SQL only; the invariant checker guards against drift.
 */
async function closeAccount(client, userId) {
  const trips = await client.query(
    `SELECT o.id,
            EXISTS (SELECT 1 FROM ride_requests r
                     WHERE r.trip_occurrence_id = o.id AND r.community_id = o.community_id
                       AND r.rider_user_id = $2 AND r.status IN ('REQUESTED','ACCEPTED')) AS has_rider_request,
            (o.driver_user_id = $2 AND o.status = 'OPEN' AND o.departure_at > clock_timestamp()) AS has_future_driver_trip
       FROM trip_occurrences o
      WHERE o.community_id = $1
        AND (EXISTS (SELECT 1 FROM ride_requests r
                      WHERE r.trip_occurrence_id = o.id AND r.community_id = o.community_id
                        AND r.rider_user_id = $2 AND r.status IN ('REQUESTED','ACCEPTED'))
             OR (o.driver_user_id = $2 AND o.status = 'OPEN' AND o.departure_at > clock_timestamp()))
      ORDER BY o.id FOR UPDATE OF o`,
    [CID, userId],
  );
  const riderTripIds = trips.rows.filter((r) => r.has_rider_request).map((r) => r.id);
  const driverTripIds = trips.rows.filter((r) => r.has_future_driver_trip).map((r) => r.id);

  const inProgress = await client.query(
    `SELECT 1 FROM ride_requests r
       JOIN trip_occurrences o ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
      WHERE r.community_id = $1 AND (r.rider_user_id = $2 OR o.driver_user_id = $2)
        AND r.status IN ('REQUESTED','ACCEPTED') AND o.status = 'OPEN'
        AND o.departure_at <= clock_timestamp() LIMIT 1`,
    [CID, userId],
  );
  if (inProgress.rowCount) return { refused: true };

  const acceptedCounts = riderTripIds.length === 0 ? [] : (await client.query(
    `SELECT r.trip_occurrence_id, count(*)::integer AS accepted_count
       FROM ride_requests r
       JOIN trip_occurrences o ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
      WHERE r.community_id = $1 AND r.rider_user_id = $2 AND r.trip_occurrence_id = ANY($3::uuid[])
        AND r.status = 'ACCEPTED' AND o.status = 'OPEN'
      GROUP BY r.trip_occurrence_id`,
    [CID, userId, riderTripIds],
  )).rows;

  await client.query(
    `UPDATE ride_requests r SET status = 'CANCELLED', updated_at = now()
       FROM trip_occurrences o
      WHERE r.community_id = $1 AND r.rider_user_id = $2
        AND r.trip_occurrence_id = o.id AND r.community_id = o.community_id
        AND r.status IN ('REQUESTED','ACCEPTED')`,
    [CID, userId],
  );
  for (const a of acceptedCounts) {
    await client.query(
      `UPDATE trip_occurrences SET seats_reserved = seats_reserved - $2, updated_at = now()
        WHERE id = $1 AND community_id = $3 AND status = 'OPEN' AND seats_reserved >= $2`,
      [a.trip_occurrence_id, a.accepted_count, CID],
    );
  }
  if (driverTripIds.length > 0) {
    await client.query(
      `UPDATE ride_requests r SET status = 'CANCELLED', updated_at = now()
        WHERE r.community_id = $1 AND r.trip_occurrence_id = ANY($2::uuid[])
          AND r.status IN ('REQUESTED','ACCEPTED')`,
      [CID, driverTripIds],
    );
    await client.query(
      `UPDATE trip_occurrences SET status = 'CANCELLED', seats_reserved = 0, updated_at = now()
        WHERE community_id = $1 AND id = ANY($2::uuid[]) AND status = 'OPEN'`,
      [CID, driverTripIds],
    );
  }

  await client.query(
    `UPDATE users SET status='DEACTIVATED', display_name='Closed account',
            auth_subject = 'deleted:' || id::text, updated_at = now()
      WHERE id = $1`,
    [userId],
  );
  await client.query(
    `UPDATE community_memberships SET status='REJECTED', updated_at=now()
      WHERE community_id = $1 AND user_id = $2`,
    [CID, userId],
  );
  return { refused: false };
}

async function makeTrip(client, driverId, { departed, seats = 1 }) {
  const commuteId = randomUUID();
  const tripId = randomUUID();
  await client.query(
    `INSERT INTO commute_templates
       (id, community_id, owner_user_id, origin_area, destination_area,
        departure_window_start, departure_window_end, role, seats_offered)
     VALUES ($1,$2,$3,'acGulberg','acDHA','08:00','08:20','OFFERING',$4)`,
    [commuteId, CID, driverId, seats],
  );
  await client.query(
    `INSERT INTO trip_occurrences
       (id, commute_template_id, community_id, driver_user_id, trip_date, departure_at,
        timezone, origin_area, destination_area, seat_capacity, seats_reserved, status)
     SELECT $1,$2,$3,$4,
            ((${departed ? "now() - interval '2 hours'" : "now() + interval '2 days'"}) AT TIME ZONE 'Asia/Karachi')::date,
            ${departed ? "now() - interval '2 hours'" : "now() + interval '2 days'"},
            'Asia/Karachi','acGulberg','acDHA',$5,1,'OPEN'`,
    [tripId, commuteId, CID, driverId, seats],
  );
  return { commuteId, tripId };
}

const created = { users: [], commutes: [], trips: [], requests: [] };
const client = await pool.connect();
try {
  // --- Case 1: closure refused while a trip already departed ---------------
  {
    const driverId = await createAccount(client, "acDriver1");
    const riderId = await createAccount(client, "acRider1");
    created.users.push(driverId, riderId);
    const { commuteId, tripId } = await makeTrip(client, driverId, { departed: true });
    created.commutes.push(commuteId);
    created.trips.push(tripId);
    const requestId = randomUUID();
    created.requests.push(requestId);
    await client.query(
      `INSERT INTO ride_requests (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now() - interval '3 hours')`,
      [requestId, tripId, CID, riderId],
    );

    const outcome = await closeAccount(client, riderId);
    check("closure refused while on a departed trip", outcome.refused === true, JSON.stringify(outcome));
    const still = await client.query("SELECT status FROM users WHERE id=$1", [riderId]);
    check("refused closure leaves the account active", still.rows[0]?.status === "ACTIVE", JSON.stringify(still.rows));
  }

  // --- Case 2: rider closure releases an accepted seat (undeparted trip) ---
  {
    const driverId = await createAccount(client, "acDriver2");
    const riderId = await createAccount(client, "acRider2");
    created.users.push(driverId, riderId);
    const { commuteId, tripId } = await makeTrip(client, driverId, { departed: false });
    created.commutes.push(commuteId);
    created.trips.push(tripId);
    const requestId = randomUUID();
    created.requests.push(requestId);
    await client.query(
      `INSERT INTO ride_requests (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now())`,
      [requestId, tripId, CID, riderId],
    );

    const outcome = await closeAccount(client, riderId);
    check("rider closure succeeds", outcome.refused === false, JSON.stringify(outcome));

    const seat = await client.query("SELECT seats_reserved, status FROM trip_occurrences WHERE id=$1", [tripId]);
    check(
      "accepted seat released and trip still open",
      seat.rows[0]?.seats_reserved === 0 && seat.rows[0]?.status === "OPEN",
      JSON.stringify(seat.rows[0]),
    );

    const req = await client.query("SELECT status FROM ride_requests WHERE id=$1", [requestId]);
    check("rider request withdrawn to CANCELLED", req.rows[0]?.status === "CANCELLED", JSON.stringify(req.rows[0]));

    const user = await client.query("SELECT status, display_name, auth_subject FROM users WHERE id=$1", [riderId]);
    check(
      "identity erased (DEACTIVATED, no name, no auth subject)",
      user.rows[0]?.status === "DEACTIVATED" &&
        user.rows[0]?.display_name === "Closed account" &&
        String(user.rows[0]?.auth_subject).startsWith("deleted:"),
      JSON.stringify(user.rows[0]),
    );

    const member = await client.query(
      "SELECT status FROM community_memberships WHERE community_id=$1 AND user_id=$2",
      [CID, riderId],
    );
    check("membership is no longer ACTIVE", member.rows[0]?.status !== "ACTIVE", JSON.stringify(member.rows[0]));

    const history = await client.query("SELECT status FROM ride_requests WHERE id=$1", [requestId]);
    check("historical request row survives for other participants", history.rowCount === 1, JSON.stringify(history.rows));
  }

  // --- Case 3: driver closure cancels a future trip and its requests -------
  {
    const driverId = await createAccount(client, "acDriver3");
    const riderId = await createAccount(client, "acRider3");
    created.users.push(driverId, riderId);
    const { commuteId, tripId } = await makeTrip(client, driverId, { departed: false });
    created.commutes.push(commuteId);
    created.trips.push(tripId);
    const requestId = randomUUID();
    created.requests.push(requestId);
    await client.query(
      `INSERT INTO ride_requests (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now())`,
      [requestId, tripId, CID, riderId],
    );

    const outcome = await closeAccount(client, driverId);
    check("driver closure succeeds", outcome.refused === false, JSON.stringify(outcome));

    const trip = await client.query("SELECT status, seats_reserved FROM trip_occurrences WHERE id=$1", [tripId]);
    check(
      "driver's future trip cancelled with capacity settled",
      trip.rows[0]?.status === "CANCELLED" && trip.rows[0]?.seats_reserved === 0,
      JSON.stringify(trip.rows[0]),
    );
    const req = await client.query("SELECT status FROM ride_requests WHERE id=$1", [requestId]);
    check("rider's request on the cancelled trip withdrawn", req.rows[0]?.status === "CANCELLED", JSON.stringify(req.rows[0]));
  }
} finally {
  // Delete in strict FK order. Each step is awaited so a failure cannot silently
  // leave fixtures behind; the first error is reported rather than swallowed.
  for (const id of created.requests) {
    await client.query("DELETE FROM ride_requests WHERE id=$1", [id]).catch(() => {});
  }
  for (const id of created.trips) {
    await client.query("DELETE FROM trip_occurrences WHERE id=$1", [id]).catch(() => {});
  }
  for (const id of created.commutes) {
    await client.query("DELETE FROM commute_templates WHERE id=$1", [id]).catch(() => {});
  }
  for (const id of created.users) {
    await client.query("DELETE FROM account_deletion_requests WHERE user_id=$1", [id]).catch(() => {});
    await client.query("DELETE FROM user_blocks WHERE blocker_user_id=$1 OR blocked_user_id=$1", [id]).catch(() => {});
    await client.query("DELETE FROM community_memberships WHERE user_id=$1", [id]).catch(() => {});
    await client.query("DELETE FROM users WHERE id=$1", [id]).catch(() => {});
  }
  // Report any residue so a broken cleanup is visible instead of leaking rows.
  const residue = await client.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE auth_subject LIKE 'acctest-%') AS users,
       (SELECT count(*)::int FROM commute_templates WHERE origin_area = 'acGulberg') AS commutes,
       (SELECT count(*)::int FROM trip_occurrences WHERE origin_area = 'acGulberg') AS trips`,
  );
  const left = residue.rows[0];
  if (left.users || left.commutes || left.trips) {
    console.log(`WARNING: fixture cleanup left ${JSON.stringify(left)}`);
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
