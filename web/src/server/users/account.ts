import { randomUUID } from "node:crypto";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { assertActiveCommunityMember } from "@/server/community/access";
import { inTransaction } from "@/server/db/pool";
import { invalid } from "@/server/rides/errors";
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
 *   4. release the membership so the account stops participating in matching.
 *
 * The retained row is a tombstone: no email, no display name, and no ability to
 * sign in. Completed trip history survives anonymously, which is what keeps
 * other participants' records coherent.
 */
export async function deleteOwnAccount(input: {
  actor: AuthenticatedActor;
  reason?: string;
}): Promise<AccountDeletionResult> {
  const reason = input.reason?.trim();
  if (reason !== undefined && reason.length > 500) {
    throw invalid("INVALID_DELETION_REASON", "Reason must be 500 characters or fewer.");
  }

  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);

    // Serialize deletion against concurrent trip/request mutations for this
    // account by taking the same per-user lock those operations rely on.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `account-delete:${input.actor.userId}`,
    ]);

    const account = await client.query<{ status: string }>(
      "SELECT status FROM users WHERE id = $1 FOR UPDATE",
      [input.actor.userId],
    );
    if (account.rows[0]?.status !== "ACTIVE") {
      throw invalid("ACCOUNT_NOT_ACTIVE", "This account is already closed.");
    }

    // A passenger or driver currently mid-trip must be resolved first, since
    // silently cancelling an in-progress trip would strand the counterparty.
    // Scoped to the caller: every account shares one marketplace community, so
    // filtering on community_id alone would match other people's trips.
    const inProgress = await client.query(
      `SELECT 1
         FROM ride_requests r
         JOIN trip_occurrences o
           ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
        WHERE r.community_id = $1
          AND (r.rider_user_id = $2 OR o.driver_user_id = $2)
          AND r.status IN ('REQUESTED', 'ACCEPTED')
          AND o.status = 'OPEN'
          AND o.departure_at <= now()
        LIMIT 1`,
      [input.actor.communityId, input.actor.userId],
    );
    if (inProgress.rowCount) {
      throw invalid(
        "ACCOUNT_HAS_IN_PROGRESS_TRIP",
        "A trip you are involved in has already departed. Resolve or wait for it to complete before closing your account.",
      );
    }

    const withdrawn = await withdrawOpenCommitments(client, input.actor);

    const requestId = randomUUID();
    await client.query(
      `INSERT INTO account_deletion_requests (id, user_id, reason, completed_at)
       VALUES ($1, $2, $3, now())`,
      [requestId, input.actor.userId, reason ?? null],
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

    // Sessions must not outlive the account.
    await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [input.actor.userId]);

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
  const requests = await client.query(
    `UPDATE ride_requests
        SET status = 'CANCELLED', updated_at = now()
      WHERE community_id = $1
        AND rider_user_id = $2
        AND status IN ('REQUESTED', 'ACCEPTED')
      RETURNING id`,
    [actor.communityId, actor.userId],
  );

  // Cancelling a future trip must also withdraw the requests attached to it;
  // releasing only the driver's own requests would leave riders holding seats
  // on a trip that no longer exists.
  const trips = await client.query<{ id: string }>(
    `SELECT id FROM trip_occurrences
      WHERE community_id = $1 AND driver_user_id = $2
        AND status = 'OPEN' AND departure_at > now()
      FOR UPDATE`,
    [actor.communityId, actor.userId],
  );

  let requestsWithdrawn = requests.rowCount ?? 0;
  if (trips.rows.length > 0) {
    const tripIds = trips.rows.map((row) => row.id);
    const released = await client.query(
      `UPDATE ride_requests
          SET status = 'CANCELLED', updated_at = now()
        WHERE community_id = $1
          AND trip_occurrence_id = ANY($2::uuid[])
          AND status IN ('REQUESTED', 'ACCEPTED')
        RETURNING id`,
      [actor.communityId, tripIds],
    );
    requestsWithdrawn += released.rowCount ?? 0;

    await client.query(
      `UPDATE trip_occurrences
          SET status = 'CANCELLED', seats_reserved = 0, updated_at = now()
        WHERE community_id = $1 AND id = ANY($2::uuid[]) AND status = 'OPEN'`,
      [actor.communityId, tripIds],
    );
  }

  return { tripsCancelled: trips.rows.length, requestsWithdrawn };
}
