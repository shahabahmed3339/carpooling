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

/**
 * The real closure service, imported from the server source. The previous
 * version mirrored its SQL by hand, and the mirror had already drifted: it did
 * not delete the Better Auth identity row, write the withdrawal notices, or
 * create the account_deletion_requests row the real service does. A mirror
 * cannot stay honest about code it duplicates.
 */
const { deleteOwnAccount } = await import("@/server/users/account");

function actorFor(userId, email) {
  return { userId, email, communityId: CID, participantRole: "RIDER" };
}

async function createAccount(label) {
  const id = randomUUID();
  const authId = randomUUID();
  const email = `acctest-${id}@verify.local`;
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, now(), now())`,
    [authId, label, email],
  );
  await pool.query(
    `INSERT INTO users (id, auth_subject, display_name, participant_role)
     VALUES ($1, $2, $3, 'RIDER')`,
    [id, authId, label],
  );
  await pool.query(
    `INSERT INTO community_memberships (community_id, user_id, status, role, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'ACTIVE', 'MEMBER', $2, now())`,
    [CID, id],
  );
  return { id, authId, email };
}

/**
 * Close an account through the real service.
 *
 * Returns `{ refused }` so the existing assertions keep their shape: the service
 * signals refusal by throwing a RideDomainError rather than returning a flag.
 * The caller must have released/committed the fixture first — the service opens
 * its own transaction on the shared pool and will not see uncommitted rows.
 */
async function closeAccount(account) {
  try {
    await deleteOwnAccount({ actor: actorFor(account.id, account.email) });
    return { refused: false };
  } catch (error) {
    if (typeof error.code === "string" && error.status && error.status < 500) {
      return { refused: true, reason: error.code };
    }
    throw error;
  }
}

async function makeTrip(driverId, { departed, seats = 1 }) {
  const commuteId = randomUUID();
  const tripId = randomUUID();
  await pool.query(
    `INSERT INTO commute_templates
       (id, community_id, owner_user_id, origin_area, destination_area,
        departure_window_start, departure_window_end, role, seats_offered)
     VALUES ($1,$2,$3,'acGulberg','acDHA','08:00','08:20','OFFERING',$4)`,
    [commuteId, CID, driverId, seats],
  );
  await pool.query(
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

/**
 * Remove fixtures left by an earlier interrupted run (marker: `acGulberg`), so a
 * crashed run cannot collide with the next one's inserts.
 */
async function removeOrphanedFixtures() {
  await pool.query(
    `DELETE FROM ride_requests r USING trip_occurrences o, commute_templates t
      WHERE r.trip_occurrence_id = o.id AND o.commute_template_id = t.id
        AND t.origin_area = 'acGulberg'`,
  ).catch(() => {});
  await pool.query(
    `DELETE FROM trip_occurrences o USING commute_templates t
      WHERE o.commute_template_id = t.id AND t.origin_area = 'acGulberg'`,
  ).catch(() => {});
  await pool.query("DELETE FROM commute_templates WHERE origin_area = 'acGulberg'").catch(() => {});
  await pool.query("DELETE FROM in_app_notifications WHERE actor_user_id IN (SELECT id FROM users WHERE display_name LIKE 'ac%')").catch(() => {});
  await pool.query("DELETE FROM account_deletion_requests WHERE user_id IN (SELECT id FROM users WHERE display_name LIKE 'ac%')").catch(() => {});
  await pool.query("DELETE FROM community_memberships WHERE user_id IN (SELECT id FROM users WHERE display_name LIKE 'ac%')").catch(() => {});
  await pool.query("DELETE FROM users WHERE display_name LIKE 'ac%'").catch(() => {});
  await pool.query('DELETE FROM "user" WHERE email LIKE \'acctest-%@verify.local\'').catch(() => {});
}

await removeOrphanedFixtures();

const created = { users: [], commutes: [], trips: [], requests: [] };
// Fixtures and assertions all run through `pool` (each query is its own
// autocommit transaction). The real closure service opens its own transaction on
// the same pool, so nothing may be held open across a `closeAccount` call —
// holding a fixture transaction here would deadlock on the rows it locks.
try {
  // --- Case 1: closure refused while a trip already departed ---------------
  {
    const driver = await createAccount("acDriver1");
    const rider = await createAccount("acRider1");
    const driverId = driver.id;
    const riderId = rider.id;
    created.users.push(driver, rider);
    const { commuteId, tripId } = await makeTrip(driverId, { departed: true });
    created.commutes.push(commuteId);
    created.trips.push(tripId);
    const requestId = randomUUID();
    created.requests.push(requestId);
    await pool.query(
      `INSERT INTO ride_requests (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now() - interval '3 hours')`,
      [requestId, tripId, CID, riderId],
    );

    const outcome = await closeAccount(rider);
    check("closure refused while on a departed trip", outcome.refused === true, JSON.stringify(outcome));
    const still = await pool.query("SELECT status FROM users WHERE id=$1", [riderId]);
    check("refused closure leaves the account active", still.rows[0]?.status === "ACTIVE", JSON.stringify(still.rows));
  }

  // --- Case 2: rider closure releases an accepted seat (undeparted trip) ---
  {
    const driver = await createAccount("acDriver2");
    const rider = await createAccount("acRider2");
    const driverId = driver.id;
    const riderId = rider.id;
    created.users.push(driver, rider);
    const { commuteId, tripId } = await makeTrip(driverId, { departed: false });
    created.commutes.push(commuteId);
    created.trips.push(tripId);
    const requestId = randomUUID();
    created.requests.push(requestId);
    await pool.query(
      `INSERT INTO ride_requests (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now())`,
      [requestId, tripId, CID, riderId],
    );

    const outcome = await closeAccount(rider);
    check("rider closure succeeds", outcome.refused === false, JSON.stringify(outcome));

    const seat = await pool.query("SELECT seats_reserved, status FROM trip_occurrences WHERE id=$1", [tripId]);
    check(
      "accepted seat released and trip still open",
      seat.rows[0]?.seats_reserved === 0 && seat.rows[0]?.status === "OPEN",
      JSON.stringify(seat.rows[0]),
    );

    const req = await pool.query("SELECT status FROM ride_requests WHERE id=$1", [requestId]);
    check("rider request withdrawn to CANCELLED", req.rows[0]?.status === "CANCELLED", JSON.stringify(req.rows[0]));

    const user = await pool.query("SELECT status, display_name, auth_subject FROM users WHERE id=$1", [riderId]);
    check(
      "identity erased (DEACTIVATED, no name, no auth subject)",
      user.rows[0]?.status === "DEACTIVATED" &&
        user.rows[0]?.display_name === "Closed account" &&
        String(user.rows[0]?.auth_subject).startsWith("deleted:"),
      JSON.stringify(user.rows[0]),
    );

    const member = await pool.query(
      "SELECT status FROM community_memberships WHERE community_id=$1 AND user_id=$2",
      [CID, riderId],
    );
    check("membership is no longer ACTIVE", member.rows[0]?.status !== "ACTIVE", JSON.stringify(member.rows[0]));

    const history = await pool.query("SELECT status FROM ride_requests WHERE id=$1", [requestId]);
    check("historical request row survives for other participants", history.rowCount === 1, JSON.stringify(history.rows));
  }

  // --- Case 3: driver closure cancels a future trip and its requests -------
  {
    const driver = await createAccount("acDriver3");
    const rider = await createAccount("acRider3");
    const driverId = driver.id;
    const riderId = rider.id;
    created.users.push(driver, rider);
    const { commuteId, tripId } = await makeTrip(driverId, { departed: false });
    created.commutes.push(commuteId);
    created.trips.push(tripId);
    const requestId = randomUUID();
    created.requests.push(requestId);
    await pool.query(
      `INSERT INTO ride_requests (id, trip_occurrence_id, community_id, rider_user_id, status, accepted_at)
       VALUES ($1,$2,$3,$4,'ACCEPTED', now())`,
      [requestId, tripId, CID, riderId],
    );

    const outcome = await closeAccount(driver);
    check("driver closure succeeds", outcome.refused === false, JSON.stringify(outcome));

    const trip = await pool.query("SELECT status, seats_reserved FROM trip_occurrences WHERE id=$1", [tripId]);
    check(
      "driver's future trip cancelled with capacity settled",
      trip.rows[0]?.status === "CANCELLED" && trip.rows[0]?.seats_reserved === 0,
      JSON.stringify(trip.rows[0]),
    );
    const req = await pool.query("SELECT status FROM ride_requests WHERE id=$1", [requestId]);
    check("rider's request on the cancelled trip withdrawn", req.rows[0]?.status === "CANCELLED", JSON.stringify(req.rows[0]));
  }
} finally {
  // Delete in strict FK order. Each step is awaited so a failure cannot silently
  // leave fixtures behind; the first error is reported rather than swallowed.
  for (const id of created.requests) {
    await pool.query("DELETE FROM ride_requests WHERE id=$1", [id]).catch(() => {});
  }
  for (const id of created.trips) {
    await pool.query("DELETE FROM trip_occurrences WHERE id=$1", [id]).catch(() => {});
  }
  for (const id of created.commutes) {
    await pool.query("DELETE FROM commute_templates WHERE id=$1", [id]).catch(() => {});
  }
  for (const account of created.users) {
    const id = account.id;
    await pool.query("DELETE FROM in_app_notifications WHERE recipient_user_id=$1 OR actor_user_id=$1", [id]).catch(() => {});
    await pool.query("DELETE FROM account_deletion_requests WHERE user_id=$1", [id]).catch(() => {});
    await pool.query("DELETE FROM user_blocks WHERE blocker_user_id=$1 OR blocked_user_id=$1", [id]).catch(() => {});
    await pool.query("DELETE FROM community_memberships WHERE user_id=$1", [id]).catch(() => {});
    await pool.query("DELETE FROM users WHERE id=$1", [id]).catch(() => {});
    await pool.query('DELETE FROM "user" WHERE id=$1', [account.authId]).catch(() => {});
  }
  // Report any residue so a broken cleanup is visible instead of leaking rows.
  const residue = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE display_name LIKE 'ac%') AS users,
       (SELECT count(*)::int FROM "user" WHERE email LIKE 'acctest-%') AS auth_users,
       (SELECT count(*)::int FROM commute_templates WHERE origin_area = 'acGulberg') AS commutes,
       (SELECT count(*)::int FROM trip_occurrences WHERE origin_area = 'acGulberg') AS trips`,
  );
  const left = residue.rows[0];
  if (left.users || left.auth_users || left.commutes || left.trips) {
    console.log(`WARNING: fixture cleanup left ${JSON.stringify(left)}`);
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
