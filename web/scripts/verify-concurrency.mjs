/**
 * Exercise the concurrency guarantees of seat reservation against a real database.
 *
 * Overbooking is the failure mode that matters most here, and it only appears
 * under real parallel writes — static checks cannot see it. This drives the same
 * guarded statements the app uses through several independent connections at the
 * same time and asserts the invariant holds:
 *
 *   - many concurrent accepts on a one-seat trip succeed at most once,
 *   - seats_reserved never exceeds seat_capacity,
 *   - the same request accepted twice reserves exactly one seat,
 *   - accepting after the seat is gone fails with NO_SEATS_AVAILABLE,
 *   - a concurrent accept and trip-cancel resolve to one coherent outcome.
 *
 * Cleans up after itself and exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-concurrency.mjs
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
  max: 12,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const CID = "00000000-0000-4000-8000-000000000002";
const results = [];
const check = (n, p, d) => results.push({ n, p, d });

const tag = `conc${randomUUID().slice(0, 8)}`;

/**
 * The real ride services, imported from the server source. The previous version
 * mirrored the acceptance guard by hand ("Mirror the acceptance guard from
 * requests.ts"), which meant the concurrency test exercised a copy of the guard.
 * The real `acceptRideRequest` also takes a per-account advisory lock via
 * `lockUserActions`, which the mirror omitted entirely — so the mirror could not
 * observe the serialization the real path relies on.
 */
const { acceptRideRequest, cancelTripOccurrence } = await import("@/server/rides/requests");

function actorFor(userId) {
  return { userId, email: `${userId}@verify.local`, communityId: CID, participantRole: "DRIVER" };
}

/** Accept a request through the real service. Returns ACCEPTED or REPLAY. */
async function acceptRequest(tripId, requestId, driverId) {
  const result = await acceptRideRequest({
    actor: actorFor(driverId),
    requestId,
    idempotencyKey: randomUUID(),
  });
  return result.body.replayedOrExisting ? "REPLAY" : "ACCEPTED";
}

async function setup(driverId, riderIds, seats) {
  const client = await pool.connect();
  try {
    const commuteId = randomUUID();
    const tripId = randomUUID();
    await client.query(
      `INSERT INTO commute_templates (id, community_id, owner_user_id, origin_area, destination_area,
         departure_window_start, departure_window_end, role, seats_offered)
       VALUES ($1,$2,$3,$4,$5,'08:00','08:20','OFFERING',$6)`,
      [commuteId, CID, driverId, `${tag}G`, `${tag}D`, seats],
    );
    await client.query(
      `INSERT INTO trip_occurrences (id, commute_template_id, community_id, driver_user_id, trip_date,
         departure_at, timezone, origin_area, destination_area, seat_capacity, seats_reserved, status)
       SELECT $1,$2,$3,$4,((now() + interval '2 days') AT TIME ZONE 'Asia/Karachi')::date,
              now() + interval '2 days','Asia/Karachi',$5,$6,$7,0,'OPEN'`,
      [tripId, commuteId, CID, driverId, `${tag}G`, `${tag}D`, seats],
    );
    const requestIds = [];
    for (const riderId of riderIds) {
      const requestId = randomUUID();
      requestIds.push(requestId);
      await client.query(
        `INSERT INTO ride_requests (id, trip_occurrence_id, community_id, rider_user_id)
         VALUES ($1,$2,$3,$4)`,
        [requestId, tripId, CID, riderId],
      );
    }
    return { commuteId, tripId, requestIds };
  } finally {
    client.release();
  }
}

async function cleanup({ commuteId, tripId }) {
  if (tripId) {
    await pool.query("DELETE FROM ride_requests WHERE trip_occurrence_id = $1", [tripId]).catch(() => {});
    await pool.query("DELETE FROM trip_occurrences WHERE id = $1", [tripId]).catch(() => {});
  }
  if (commuteId) await pool.query("DELETE FROM commute_templates WHERE id = $1", [commuteId]).catch(() => {});
}

// Own the fixture accounts: the real accept path checks the caller's current
// participant role (DRIVER) and active membership in the database, so a borrowed
// account may be the wrong role or a reviewer.
const createdAccounts = [];
async function createAccount() {
  const userId = randomUUID();
  const authId = randomUUID();
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'conc fixture', $2, true, now(), now())`,
    [authId, `conc-${userId}@verify.local`],
  );
  await pool.query(
    `INSERT INTO users (id, auth_subject, display_name, participant_role, status)
     VALUES ($1, $2, 'conc fixture', 'DRIVER', 'ACTIVE')`,
    [userId, authId],
  );
  await pool.query(
    `INSERT INTO community_memberships (community_id, user_id, status, role, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'ACTIVE', 'MEMBER', $2, now())`,
    [CID, userId],
  );
  createdAccounts.push({ userId, authId });
  return userId;
}

const driver = await createAccount();
const riders = [await createAccount(), await createAccount(), await createAccount(), await createAccount()];

// --- Case 1: N riders race for a single seat -------------------------------
{
  const fixture = await setup(driver, riders.slice(0, 4), 1);
  try {
    const outcomes = await Promise.allSettled(
      fixture.requestIds.map((requestId) => acceptRequest(fixture.tripId, requestId, driver)),
    );
    const accepted = outcomes.filter((o) => o.status === "fulfilled" && o.value === "ACCEPTED").length;
    const replayed = outcomes.filter((o) => o.status === "fulfilled" && o.value === "REPLAY").length;
    const failed = outcomes.filter((o) => o.status === "rejected").length;
    const codes = outcomes.filter((o) => o.status === "rejected").map((o) => o.reason.code);

    check("exactly one concurrent accept succeeds on a one-seat trip", accepted === 1, `accepted=${accepted} replayed=${replayed} failed=${failed}`);
    check("the losers are rejected for lack of seats", codes.every((c) => c === "NO_SEATS_AVAILABLE"), JSON.stringify(codes));
    // Regression guard: before the lock-order fix, four concurrent accepts by one
    // driver deadlocked (Postgres 40P01) because each transaction took its
    // idempotency-row lock and then contended on the driver's advisory lock. The
    // mirror this script used to run could not see it — it omitted both the
    // advisory lock and the idempotency insert. Assert the code explicitly so a
    // reintroduced cycle fails here by name rather than merely changing the count.
    check(
      "no accept deadlocks under contention",
      !codes.includes("40P01") && !outcomes.some((o) => o.status === "rejected" && /deadlock/i.test(o.reason.message ?? "")),
      JSON.stringify(codes),
    );

    const trip = await pool.query("SELECT seats_reserved, seat_capacity FROM trip_occurrences WHERE id = $1", [fixture.tripId]);
    check(
      "seats_reserved never exceeds seat_capacity",
      trip.rows[0].seats_reserved <= trip.rows[0].seat_capacity && trip.rows[0].seats_reserved === 1,
      JSON.stringify(trip.rows[0]),
    );
    const acceptedRows = await pool.query(
      "SELECT count(*)::int n FROM ride_requests WHERE trip_occurrence_id = $1 AND status = 'ACCEPTED'",
      [fixture.tripId],
    );
    check(
      "accepted requests match the seats reserved",
      acceptedRows.rows[0].n === trip.rows[0].seats_reserved,
      `accepted=${acceptedRows.rows[0].n} reserved=${trip.rows[0].seats_reserved}`,
    );
  } finally {
    await cleanup(fixture);
  }
}

// --- Case 2: the same request accepted concurrently twice ------------------
{
  const fixture = await setup(driver, riders.slice(0, 1), 2);
  try {
    const outcomes = await Promise.allSettled([
      acceptRequest(fixture.tripId, fixture.requestIds[0], driver),
      acceptRequest(fixture.tripId, fixture.requestIds[0], driver),
    ]);
    const trip = await pool.query("SELECT seats_reserved FROM trip_occurrences WHERE id = $1", [fixture.tripId]);
    check(
      "accepting the same request twice reserves exactly one seat",
      trip.rows[0].seats_reserved === 1,
      `reserved=${trip.rows[0].seats_reserved} outcomes=${JSON.stringify(outcomes.map((o) => (o.status === "fulfilled" ? o.value : o.reason.message)))}`,
    );
  } finally {
    await cleanup(fixture);
  }
}

// --- Case 3: concurrent accept and trip cancel -----------------------------
{
  const fixture = await setup(driver, riders.slice(0, 2), 2);
  try {
    const cancel = () =>
      cancelTripOccurrence({
        actor: actorFor(driver),
        tripOccurrenceId: fixture.tripId,
        idempotencyKey: randomUUID(),
      });

    await Promise.allSettled([
      cancel(),
      acceptRequest(fixture.tripId, fixture.requestIds[0], driver),
    ]);

    const trip = await pool.query("SELECT status, seats_reserved FROM trip_occurrences WHERE id = $1", [fixture.tripId]);
    const accepted = await pool.query(
      "SELECT count(*)::int n FROM ride_requests WHERE trip_occurrence_id = $1 AND status = 'ACCEPTED'",
      [fixture.tripId],
    );
    // Either the accept won (trip OPEN, 1 seat, request ACCEPTED) or the cancel
    // won (trip CANCELLED, 0 seats, no accepted request). Never a mix.
    const coherent =
      (trip.rows[0].status === "CANCELLED" && trip.rows[0].seats_reserved === 0 && accepted.rows[0].n === 0) ||
      (trip.rows[0].status === "OPEN" && trip.rows[0].seats_reserved === 1 && accepted.rows[0].n === 1);
    check(
      "concurrent accept and cancel resolve to one coherent outcome",
      coherent,
      JSON.stringify({ trip: trip.rows[0], accepted: accepted.rows[0].n }),
    );
    check(
      "no accepted request is left on a cancelled trip",
      !(trip.rows[0].status === "CANCELLED" && accepted.rows[0].n > 0),
      JSON.stringify({ trip: trip.rows[0], accepted: accepted.rows[0].n }),
    );
  } finally {
    await cleanup(fixture);
  }
}

// --- Case 4: the database constraint is a real backstop --------------------
//
// The app's capacity guard is the first line of defence. This case removes it
// entirely and confirms the database CHECK still refuses to overbook, so the
// test above cannot be passing vacuously and a future guard removal would still
// be caught by the database rather than silently overbooking.
{
  const fixture = await setup(driver, riders.slice(0, 3), 1);
  try {
    const violations = [];
    const unguardedAccept = async (requestId) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM trip_occurrences WHERE id = $1 FOR UPDATE", [fixture.tripId]);
        // No capacity guard on purpose.
        await client.query(
          "UPDATE trip_occurrences SET seats_reserved = seats_reserved + 1 WHERE id = $1",
          [fixture.tripId],
        );
        await client.query(
          "UPDATE ride_requests SET status='ACCEPTED', accepted_at=now() WHERE id=$1 AND status='REQUESTED'",
          [requestId],
        );
        await client.query("COMMIT");
      } catch (error) {
        violations.push(error.message);
        await client.query("ROLLBACK").catch(() => {});
      } finally {
        client.release();
      }
    };
    await Promise.allSettled(fixture.requestIds.map((id) => unguardedAccept(id)));
    const trip = await pool.query("SELECT seats_reserved, seat_capacity FROM trip_occurrences WHERE id = $1", [fixture.tripId]);
    check(
      "database constraint refuses overbooking even with no app guard",
      trip.rows[0].seats_reserved <= trip.rows[0].seat_capacity && violations.length > 0,
      JSON.stringify({ trip: trip.rows[0], violations }),
    );
    } finally {
      await cleanup(fixture);
    }
  }

  // Remove the accounts this run created, in FK order.
  for (const account of createdAccounts) {
    await pool.query("DELETE FROM in_app_notifications WHERE recipient_user_id = $1 OR actor_user_id = $1", [account.userId]).catch(() => {});
    await pool.query("DELETE FROM community_memberships WHERE user_id = $1", [account.userId]).catch(() => {});
    await pool.query("DELETE FROM users WHERE id = $1", [account.userId]).catch(() => {});
    await pool.query('DELETE FROM "user" WHERE id = $1', [account.authId]).catch(() => {});
  }

  let failed = 0;
for (const r of results) {
  if (!r.p) failed += 1;
  console.log(`${r.p ? "PASS" : "FAIL"}  ${r.n}${r.p ? "" : `  -> ${r.d}`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
