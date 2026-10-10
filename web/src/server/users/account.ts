import { randomUUID } from "node:crypto";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { assertActiveCommunityMember } from "@/server/community/access";
import { inTransaction } from "@/server/db/pool";
import { conflict, invalid } from "@/server/rides/errors";
import { lockUserActions } from "@/server/users/action-lock";
import { addNotification } from "@/server/notifications/inbox";
import type { PoolClient } from "pg";

export type AccountDeletionResult = {
  status: "DEACTIVATED";
  tripsCancelled: number;
  requestsWithdrawn: number;
};

/**
 * Close the caller's own account.
 *
 * This is intentionally not a hard delete: trips, requests, reports, and
 * idempotency receipts reference the user row, and removing it would either
 * break those records or destroy other participants' history. Instead we:
 *   1. refuse while the account still has live commitments it must resolve,
 *   2. withdraw its pending/accepted requests and cancel its future trips,
 *   3. deactivate the account and erase identifying fields,
 *   4. release membership and authentication records so the account cannot
 *      participate in matching or retain a sign-in identity.
 *
 * The retained row is a tombstone: no email, no display name, and no ability to
 * sign in. Completed trip history survives anonymously, which is what keeps
 * other participants' records coherent.
 */
export async function deleteOwnAccount(input: {
  actor: AuthenticatedActor;
}): Promise<AccountDeletionResult> {
  return inTransaction(async (client) => {
    await lockUserActions(client, [input.actor.userId]);
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);

    const account = await client.query<{ status: string; auth_subject: string }>(
      "SELECT status, auth_subject FROM users WHERE id = $1 FOR UPDATE",
      [input.actor.userId],
    );
    if (account.rows[0]?.status !== "ACTIVE") {
      throw invalid("ACCOUNT_NOT_ACTIVE", "This account is already closed.");
    }
    const authSubject = account.rows[0].auth_subject;

    const withdrawn = await withdrawOpenCommitments(client, input.actor);

    const requestId = randomUUID();
    await client.query(
      `INSERT INTO account_deletion_requests (id, user_id, reason, completed_at)
       VALUES ($1, $2, NULL, now())`,
      [requestId, input.actor.userId],
    );

    // Erase identifying data. display_name stays non-null (NOT NULL + length
    // CHECK) so it is replaced with an opaque marker rather than blanked.
    await client.query(
      `UPDATE users
          SET status = 'DEACTIVATED',
              display_name = 'Closed account',
              auth_subject = 'deleted:' || id::text,
              updated_at = now()
        WHERE id = $1`,
      [input.actor.userId],
    );

    // Release membership so the account no longer appears in matching or in
    // other participants' searches. History rows keep their FK to the user.
    await client.query(
      `UPDATE community_memberships
          SET status = 'REJECTED', updated_at = now()
        WHERE community_id = $1 AND user_id = $2`,
      [input.actor.communityId, input.actor.userId],
    );

    // Erase the ratings this account wrote or received.
    //
    // A rating is personal data pointing at a person: the read path joins
    // `users` to show the author's name, so a rating left behind after closure
    // would keep a name attached to a tombstone that is supposed to have no
    // identity. Ratings are otherwise immutable (a user cannot withdraw one), so
    // the erasure is signalled explicitly with a session flag that 0031's trigger
    // honours — the alternative, a blanket delete allowance, is what let a user
    // retract a rating in the first place.
    await client.query("SET LOCAL app.allow_rating_erasure = 'on'");
    await client.query(
      `DELETE FROM trip_ratings
        WHERE community_id = $1 AND (author_user_id = $2 OR subject_user_id = $2)`,
      [input.actor.communityId, input.actor.userId],
    );

    // Remove the authentication identity and credentials as well as sessions.
    // Better Auth uses its default model names here (`user`, `account`,
    // `session`, `verification`); this app's separate `users` row remains as
    // the anonymous historical tombstone above.
    await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [authSubject]);
    await client.query(`DELETE FROM "account" WHERE "userId" = $1`, [authSubject]);
    // The magic-link plugin keys verification rows by a hashed token, not email.
    // Its JSON payload carries the email; match only its known JSON prefix so
    // unrelated verification records are left untouched.
    await client.query(
      `DELETE FROM "verification"
        WHERE CASE
          WHEN value LIKE '{"type":"magic-link","email":%'
            THEN lower(value::jsonb ->> 'email') = lower($1)
          ELSE false
        END`,
      [input.actor.email],
    );
    await client.query(`DELETE FROM "user" WHERE id = $1`, [authSubject]);

    return {
      status: "DEACTIVATED",
      tripsCancelled: withdrawn.tripsCancelled,
      requestsWithdrawn: withdrawn.requestsWithdrawn,
    };
  });
}

/** Withdraw the account's open requests and cancel its future trips. */
async function withdrawOpenCommitments(
  client: PoolClient,
  actor: AuthenticatedActor,
): Promise<{ tripsCancelled: number; requestsWithdrawn: number }> {
  // Lock all affected trips in one stable order, before their request rows.
  // This makes acceptance/cancellation races resolve to one complete outcome
  // and avoids deadlocks if this account is a rider on one trip and driver on
  // another.
  const trips = await client.query<{ id: string; has_rider_request: boolean; has_future_driver_trip: boolean }>(
    `SELECT o.id,
            EXISTS (
              SELECT 1 FROM ride_requests r
               WHERE r.trip_occurrence_id = o.id AND r.community_id = o.community_id
                 AND r.rider_user_id = $2 AND r.status IN ('REQUESTED', 'ACCEPTED')
            ) AS has_rider_request,
            (o.driver_user_id = $2 AND o.status = 'OPEN' AND o.departure_at > clock_timestamp()) AS has_future_driver_trip
       FROM trip_occurrences o
      WHERE o.community_id = $1
        AND (
          EXISTS (
            SELECT 1 FROM ride_requests r
             WHERE r.trip_occurrence_id = o.id AND r.community_id = o.community_id
               AND r.rider_user_id = $2 AND r.status IN ('REQUESTED', 'ACCEPTED')
          ) OR (
            o.driver_user_id = $2 AND o.status = 'OPEN' AND o.departure_at > clock_timestamp()
          )
        )
      ORDER BY o.id
      FOR UPDATE OF o`,
    [actor.communityId, actor.userId],
  );
  const riderTripIds = trips.rows.filter((row) => row.has_rider_request).map((row) => row.id);
  const driverTripIds = trips.rows.filter((row) => row.has_future_driver_trip).map((row) => row.id);

  // Recheck after acquiring trip locks, using wall-clock time. A departure
  // could pass while closure waited for another transaction to release a lock.
  const inProgress = await client.query(
    `SELECT 1
       FROM ride_requests r
       JOIN trip_occurrences o
         ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
      WHERE r.community_id = $1
        AND (r.rider_user_id = $2 OR o.driver_user_id = $2)
        AND r.status IN ('REQUESTED', 'ACCEPTED')
        AND o.status = 'OPEN'
        AND o.departure_at <= clock_timestamp()
      LIMIT 1`,
    [actor.communityId, actor.userId],
  );
  if (inProgress.rowCount) {
    throw invalid(
      "ACCOUNT_HAS_IN_PROGRESS_TRIP",
      "A trip you are involved in has already departed. Resolve or wait for it to complete before closing your account.",
    );
  }

  const acceptedCounts = riderTripIds.length === 0 ? [] : (await client.query<{ trip_occurrence_id: string; accepted_count: number }>(
    `SELECT r.trip_occurrence_id, count(*)::integer AS accepted_count
       FROM ride_requests r
       JOIN trip_occurrences o ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
      WHERE r.community_id = $1 AND r.rider_user_id = $2
        AND r.trip_occurrence_id = ANY($3::uuid[])
        AND r.status = 'ACCEPTED' AND o.status = 'OPEN'
      GROUP BY r.trip_occurrence_id
      ORDER BY r.trip_occurrence_id`,
    [actor.communityId, actor.userId, riderTripIds],
  )).rows;

  const requests = await client.query<{ id: string; trip_occurrence_id: string; driver_user_id: string }>(
    `UPDATE ride_requests r
        SET status = 'CANCELLED', updated_at = now()
       FROM trip_occurrences o
      WHERE r.community_id = $1 AND r.rider_user_id = $2
        AND r.trip_occurrence_id = o.id AND r.community_id = o.community_id
        AND r.status IN ('REQUESTED', 'ACCEPTED')
      RETURNING r.id, r.trip_occurrence_id, o.driver_user_id`,
    [actor.communityId, actor.userId],
  );
  for (const request of requests.rows) {
    await addNotification(client, {
      communityId: actor.communityId,
      recipientUserId: request.driver_user_id,
      actorUserId: actor.userId,
      kind: "RIDE_CANCELLED",
      eventKey: `account-close-ride-cancelled:${request.id}`,
      title: "Seat request cancelled",
      body: "A participant closed their account, so their seat request was withdrawn.",
      resourceType: "RIDE_REQUEST",
      resourceId: request.id,
    });
  }
  for (const accepted of acceptedCounts) {
    const releasedSeat = await client.query(
      `UPDATE trip_occurrences
          SET seats_reserved = seats_reserved - $2, updated_at = now()
        WHERE id = $1 AND community_id = $3 AND status = 'OPEN'
          AND seats_reserved >= $2
        RETURNING id`,
      [accepted.trip_occurrence_id, accepted.accepted_count, actor.communityId],
    );
    if (releasedSeat.rowCount !== 1) {
      throw conflict("CAPACITY_STATE_INVALID", "Trip seat counts are inconsistent. Account closure was not completed.");
    }
  }

  // Cancelling a future trip must also withdraw the requests attached to it;
  // releasing only the driver's own requests would leave riders holding seats
  // on a trip that no longer exists.
  let requestsWithdrawn = requests.rowCount ?? 0;
  if (driverTripIds.length > 0) {
    const released = await client.query<{ id: string; trip_occurrence_id: string; rider_user_id: string }>(
      `UPDATE ride_requests r
          SET status = 'CANCELLED', updated_at = now()
        WHERE r.community_id = $1
          AND r.trip_occurrence_id = ANY($2::uuid[])
          AND r.status IN ('REQUESTED', 'ACCEPTED')
        RETURNING r.id, r.trip_occurrence_id, r.rider_user_id`,
      [actor.communityId, driverTripIds],
    );
    requestsWithdrawn += released.rowCount ?? 0;

    for (const request of released.rows) {
      await addNotification(client, {
        communityId: actor.communityId,
        recipientUserId: request.rider_user_id,
        actorUserId: actor.userId,
        kind: "TRIP_CANCELLED",
        eventKey: `account-close-trip-cancelled:${request.trip_occurrence_id}:${request.id}`,
        title: "Trip cancelled",
        body: "The driver closed their account, so this trip and your seat request were cancelled.",
        resourceType: "TRIP_OCCURRENCE",
        resourceId: request.trip_occurrence_id,
      });
    }

    await client.query(
      `UPDATE trip_occurrences
          SET status = 'CANCELLED', seats_reserved = 0, updated_at = now()
        WHERE community_id = $1 AND id = ANY($2::uuid[]) AND status = 'OPEN'`,
      [actor.communityId, driverTripIds],
    );
  }

  return { tripsCancelled: driverTripIds.length, requestsWithdrawn };
}
