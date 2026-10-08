import { randomUUID } from "node:crypto";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { assertActiveCommunityMember } from "@/server/community/access";
import { inTransaction } from "@/server/db/pool";
import { addNotification } from "@/server/notifications/inbox";
import { lockUserActions } from "@/server/users/action-lock";
import { conflict, forbidden, invalid, notFound } from "@/server/rides/errors";
import type { PoolClient } from "pg";

export type CompletionResult = {
  requestId: string;
  tripOccurrenceId: string;
  status: "ACCEPTED" | "COMPLETED" | "DISPUTED";
  riderConfirmed: boolean;
  driverConfirmed: boolean;
};

type RequestRow = {
  id: string;
  trip_occurrence_id: string;
  rider_user_id: string;
  status: string;
  rider_confirmed_completion: boolean;
  driver_confirmed_completion: boolean;
};

type TripRow = {
  id: string;
  driver_user_id: string;
  status: string;
  departure_at: Date;
};

async function completionWindow(client: PoolClient): Promise<number> {
  const result = await client.query<{ seconds: string }>(
    "SELECT extract(epoch FROM completion_window)::text AS seconds FROM trip_policy WHERE id = true",
  );
  const seconds = Number(result.rows[0]?.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw conflict("TRIP_POLICY_MISSING", "Trip completion policy is not configured.");
  }
  return seconds * 1000;
}

/**
 * Confirm that a trip happened.
 *
 * Both sides confirm independently. The request becomes COMPLETED only when
 * both have; until then it stays ACCEPTED with one flag set. A rider and driver
 * disagreeing is not inferred automatically — either side can raise a dispute.
 *
 * Locks follow the same global order as every other ride operation
 * (trip row, then request row) so this cannot deadlock against accept/cancel.
 */
export async function confirmTripCompletion(input: {
  actor: AuthenticatedActor;
  requestId: string;
  idempotencyKey: string;
}): Promise<CompletionResult> {
  return inTransaction(async (client) => {
    await lockUserActions(client, [input.actor.userId]);
    const lookup = await client.query<{ trip_occurrence_id: string }>(
      "SELECT trip_occurrence_id FROM ride_requests WHERE id = $1",
      [input.requestId],
    );
    const tripId = lookup.rows[0]?.trip_occurrence_id;
    if (!tripId) throw notFound();

    const tripResult = await client.query<TripRow>(
      `SELECT id, driver_user_id, status, departure_at
         FROM trip_occurrences
        WHERE id = $1 AND community_id = $2
        FOR UPDATE`,
      [tripId, input.actor.communityId],
    );
    const trip = tripResult.rows[0];
    if (!trip) throw notFound();

    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);

    const requestResult = await client.query<RequestRow>(
      `SELECT id, trip_occurrence_id, rider_user_id, status,
              rider_confirmed_completion, driver_confirmed_completion
         FROM ride_requests
        WHERE id = $1 AND trip_occurrence_id = $2
        FOR UPDATE`,
      [input.requestId, trip.id],
    );
    const request = requestResult.rows[0];
    if (!request) throw notFound();

    const isRider = request.rider_user_id === input.actor.userId;
    const isDriver = trip.driver_user_id === input.actor.userId;
    if (!isRider && !isDriver) throw forbidden();

    // Completion is a statement about the past, so it is only meaningful after
    // the trip was due to depart.
    if (trip.departure_at > new Date()) {
      throw conflict("TRIP_NOT_DEPARTED", "You can confirm completion after the trip's departure time.");
    }
    if (trip.status === "CANCELLED") {
      throw conflict("TRIP_CANCELLED", "This trip was cancelled.");
    }
    if (request.status === "CANCELLED" || request.status === "REJECTED") {
      throw conflict("REQUEST_NOT_ACTIVE", "This seat request is no longer active.");
    }
    // A seat that was never accepted was never granted, so there is nothing to
    // confirm. Saying so is clearer than implying the action might succeed.
    if (request.status === "REQUESTED" || request.status === "EXPIRED") {
      throw conflict(
        "REQUEST_NOT_ACCEPTED",
        "This seat was never accepted, so there is no trip to confirm.",
      );
    }
    if (request.status === "COMPLETED") {
      return {
        requestId: request.id,
        tripOccurrenceId: trip.id,
        status: "COMPLETED",
        riderConfirmed: true,
        driverConfirmed: true,
      };
    }
    if (request.status === "DISPUTED") {
      throw conflict("REQUEST_DISPUTED", "This trip has an unresolved dispute.");
    }

    const windowMs = await completionWindow(client);
    if (Date.now() - trip.departure_at.getTime() > windowMs) {
      throw conflict("COMPLETION_WINDOW_CLOSED", "The window for confirming this trip has closed.");
    }

    // Record this side's confirmation. Setting an already-set flag is harmless
    // and keeps the endpoint idempotent without a separate replay table.
    const updated = await client.query<RequestRow>(
      `UPDATE ride_requests
          SET rider_confirmed_completion  = rider_confirmed_completion  OR $3,
              driver_confirmed_completion = driver_confirmed_completion OR $4,
              updated_at = now()
        WHERE id = $1 AND trip_occurrence_id = $2
          AND status = 'ACCEPTED'
        RETURNING id, trip_occurrence_id, rider_user_id, status,
                  rider_confirmed_completion, driver_confirmed_completion`,
      [request.id, trip.id, isRider, isDriver],
    );
    const row = updated.rows[0];
    if (!row) throw conflict("REQUEST_NOT_ACTIVE", "This seat request is no longer active.");

    if (!(row.rider_confirmed_completion && row.driver_confirmed_completion)) {
      const wasAlreadyConfirmed = isRider
        ? request.rider_confirmed_completion
        : request.driver_confirmed_completion;
      if (!wasAlreadyConfirmed) {
        const confirmer = isRider ? "rider" : "driver";
        await addNotification(client, {
          communityId: input.actor.communityId,
          recipientUserId: isRider ? trip.driver_user_id : request.rider_user_id,
          actorUserId: input.actor.userId,
          kind: "COMPLETION_CONFIRMED",
          eventKey: `completion-confirmed:${request.id}:${input.actor.userId}`,
          title: "Trip completion confirmed",
          body: `The ${confirmer} confirmed this trip. Please review it in your dashboard.`,
          resourceType: "RIDE_REQUEST",
          resourceId: request.id,
        });
      }
      return {
        requestId: row.id,
        tripOccurrenceId: trip.id,
        status: "ACCEPTED",
        riderConfirmed: row.rider_confirmed_completion,
        driverConfirmed: row.driver_confirmed_completion,
      };
    }

    // Both confirmed: close the request. The DB CHECK enforces that COMPLETED
    // always carries completed_at and both flags.
    const completed = await client.query<{ id: string }>(
      `UPDATE ride_requests
          SET status = 'COMPLETED', completed_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'ACCEPTED'
        RETURNING id`,
      [row.id],
    );
    if (completed.rowCount !== 1) {
      throw conflict("REQUEST_NOT_ACTIVE", "This seat request changed. Refresh and try again.");
    }

    await closeTripIfSettled(client, trip.id);

    for (const recipientUserId of [request.rider_user_id, trip.driver_user_id]) {
      await addNotification(client, {
        communityId: input.actor.communityId,
        recipientUserId,
        actorUserId: input.actor.userId,
        kind: "TRIP_COMPLETED",
        eventKey: `trip-completed:${request.id}:${recipientUserId}`,
        title: "Trip marked complete",
        body: "Both participants confirmed this trip.",
        resourceType: "RIDE_REQUEST",
        resourceId: request.id,
      });
    }

    return {
      requestId: row.id,
      tripOccurrenceId: trip.id,
      status: "COMPLETED",
      riderConfirmed: true,
      driverConfirmed: true,
    };
  });
}

/**
 * A trip is COMPLETED once every accepted seat has been confirmed complete.
 * Trips with no accepted seats are left alone; there is nothing to confirm, and
 * expiring them is the sweep's job.
 */
async function closeTripIfSettled(client: PoolClient, tripId: string): Promise<void> {
  const outstanding = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM ride_requests WHERE trip_occurrence_id = $1 AND status = 'ACCEPTED'",
    [tripId],
  );
  if (Number(outstanding.rows[0]?.count ?? 0) > 0) return;

  const settled = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM ride_requests WHERE trip_occurrence_id = $1 AND status = 'COMPLETED'",
    [tripId],
  );
  if (Number(settled.rows[0]?.count ?? 0) === 0) return;

  // Closing the trip must also settle its capacity. Once every accepted seat is
  // resolved there is nobody left holding a seat, so leaving seats_reserved
  // non-zero would strand capacity on a finished trip forever.
  await client.query(
    `UPDATE trip_occurrences
        SET status = 'COMPLETED',
            seats_reserved = 0,
            updated_at = now()
      WHERE id = $1 AND status = 'OPEN'`,
    [tripId],
  );
}

/** Either side can record that the trip did not happen as agreed. */
export async function disputeTripCompletion(input: {
  actor: AuthenticatedActor;
  requestId: string;
  reason: string;
  idempotencyKey: string;
}): Promise<{ requestId: string; status: "DISPUTED" }> {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 1000) {
    throw invalid("INVALID_DISPUTE_REASON", "Describe the problem in 1 to 1,000 characters.");
  }

  return inTransaction(async (client) => {
    await lockUserActions(client, [input.actor.userId]);
    const lookup = await client.query<{ trip_occurrence_id: string }>(
      "SELECT trip_occurrence_id FROM ride_requests WHERE id = $1",
      [input.requestId],
    );
    const tripId = lookup.rows[0]?.trip_occurrence_id;
    if (!tripId) throw notFound();

    const tripResult = await client.query<TripRow>(
      `SELECT id, driver_user_id, status, departure_at
         FROM trip_occurrences
        WHERE id = $1 AND community_id = $2
        FOR UPDATE`,
      [tripId, input.actor.communityId],
    );
    const trip = tripResult.rows[0];
    if (!trip) throw notFound();

    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);

    const requestResult = await client.query<RequestRow>(
      `SELECT id, trip_occurrence_id, rider_user_id, status,
              rider_confirmed_completion, driver_confirmed_completion
         FROM ride_requests
        WHERE id = $1 AND trip_occurrence_id = $2
        FOR UPDATE`,
      [input.requestId, trip.id],
    );
    const request = requestResult.rows[0];
    if (!request) throw notFound();

    const isRider = request.rider_user_id === input.actor.userId;
    const isDriver = trip.driver_user_id === input.actor.userId;
    if (!isRider && !isDriver) throw forbidden();
    if (request.status !== "ACCEPTED") {
      throw conflict("REQUEST_NOT_DISPUTABLE", "Only an accepted, uncompleted trip can be disputed.");
    }
    if (trip.departure_at > new Date()) {
      throw conflict("TRIP_NOT_DEPARTED", "You can report a problem once the trip's departure time has passed.");
    }

    await client.query(
      `INSERT INTO trip_disputes (id, community_id, ride_request_id, raised_by_user_id, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ride_request_id, raised_by_user_id) DO UPDATE
         SET reason = EXCLUDED.reason`,
      [randomUUID(), input.actor.communityId, request.id, input.actor.userId, reason],
    );

    // DISPUTED deliberately clears completed_at, per the schema's invariant that
    // a disputed request is never also recorded as completed.
    await client.query(
      `UPDATE ride_requests
          SET status = 'DISPUTED', completed_at = NULL, updated_at = now()
        WHERE id = $1 AND status = 'ACCEPTED'`,
      [request.id],
    );

    await addNotification(client, {
      communityId: input.actor.communityId,
      recipientUserId: isRider ? trip.driver_user_id : request.rider_user_id,
      actorUserId: input.actor.userId,
      kind: "TRIP_DISPUTED",
      eventKey: `trip-disputed:${request.id}:${input.actor.userId}`,
      title: "Trip issue reported",
      body: "The other participant reported a problem with this trip. Review your dashboard.",
      resourceType: "RIDE_REQUEST",
      resourceId: request.id,
    });

    return { requestId: request.id, status: "DISPUTED" };
  });
}

export type CompletionOutcome =
  | "RIDER_UNCONFIRMED"
  | "DRIVER_UNCONFIRMED"
  | "NEITHER_CONFIRMED"
  | "BOTH_CONFIRMED";

/**
 * Classify why a request lapsed. Derived from the confirmation flags rather than
 * stored separately, so it cannot drift from the flags it describes.
 */
export function classifyOutcome(
  riderConfirmed: boolean,
  driverConfirmed: boolean,
): CompletionOutcome {
  if (riderConfirmed && driverConfirmed) return "BOTH_CONFIRMED";
  if (riderConfirmed) return "DRIVER_UNCONFIRMED";
  if (driverConfirmed) return "RIDER_UNCONFIRMED";
  return "NEITHER_CONFIRMED";
}

/**
 * Housekeeping entry point: expire requests whose completion window closed
 * without both sides confirming, and close out departed trips with nothing
 * outstanding. Invoked opportunistically when an account reads its activity, so
 * a stale trip cannot keep presenting itself as awaiting confirmation.
 */
export async function expireStaleTrips(): Promise<{
  requestsExpired: number;
  tripsCompleted: number;
  noShowEvidenceRecorded: number;
}> {
  return inTransaction((client) => expireStaleTripsIn(client));
}

/**
 * Sweep implementation sharing the caller's transaction.
 *
 * Exported so the dashboard read path can reuse it instead of carrying its own
 * copy; a second copy previously drifted and closed trips without releasing
 * capacity. Every statement is guarded by current status, so this is safe to run
 * repeatedly and concurrently: a losing race simply matches nothing.
 */
export async function expireStaleTripsIn(client: PoolClient): Promise<{
  requestsExpired: number;
  tripsCompleted: number;
  noShowEvidenceRecorded: number;
}> {
  // Lock parent trips first, in a stable order, like accept/cancel/account
  // closure. Bound each dashboard-triggered sweep and let concurrent sweeps
  // take different batches instead of blocking on the same due trips.
  const dueTrips = await client.query<{ id: string }>(
    `SELECT o.id
       FROM trip_occurrences o
      WHERE (
        (o.status = 'OPEN' AND (
          EXISTS (
            SELECT 1 FROM ride_requests r
             WHERE r.trip_occurrence_id = o.id AND r.status = 'ACCEPTED'
               AND o.departure_at < now() - (SELECT completion_window FROM trip_policy WHERE id = true)
          )
          OR (o.departure_at < now() AND NOT EXISTS (
            SELECT 1 FROM ride_requests r
             WHERE r.trip_occurrence_id = o.id AND r.status = 'ACCEPTED'
          ))
        ))
        OR (o.status <> 'CANCELLED' AND EXISTS (
          SELECT 1 FROM ride_requests r
           WHERE r.trip_occurrence_id = o.id AND r.status = 'REQUESTED'
             AND o.departure_at <= now()
        ))
        )
      ORDER BY o.id
      LIMIT 25
      FOR UPDATE OF o SKIP LOCKED`,
  );
  const dueTripIds = dueTrips.rows.map((row) => row.id);

  // Capture the confirmation flags as they stood when the window lapsed. The
    // RETURNING clause reports the pre-update values, which is exactly the
    // evidence a no-show policy needs: which side, if any, had confirmed.
    const expired = await client.query<{
      id: string;
      community_id: string;
      rider_user_id: string;
      driver_user_id: string;
      rider_confirmed_completion: boolean;
      driver_confirmed_completion: boolean;
      departed_at: Date;
    }>(
      `UPDATE ride_requests r
          SET status = 'EXPIRED', updated_at = now()
        FROM trip_occurrences o
        WHERE o.id = r.trip_occurrence_id
          AND o.id = ANY($1::uuid[])
          AND r.status = 'ACCEPTED'
          AND o.status = 'OPEN'
          AND o.departure_at < now() - (SELECT completion_window FROM trip_policy WHERE id = true)
        RETURNING r.id, r.community_id, r.rider_user_id, o.driver_user_id,
                  r.rider_confirmed_completion,
                  r.driver_confirmed_completion, o.departure_at AS departed_at`,
      [dueTripIds],
    );

    let noShowEvidenceRecorded = 0;
    for (const row of expired.rows) {
      const inserted = await client.query(
        `INSERT INTO trip_no_show_evidence
           (ride_request_id, community_id, outcome, rider_confirmed, driver_confirmed, departed_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (ride_request_id) DO NOTHING`,
        [
          row.id,
          row.community_id,
          classifyOutcome(row.rider_confirmed_completion, row.driver_confirmed_completion),
          row.rider_confirmed_completion,
          row.driver_confirmed_completion,
          row.departed_at,
        ],
      );
      noShowEvidenceRecorded += inserted.rowCount ?? 0;
      for (const recipientUserId of [row.rider_user_id, row.driver_user_id]) {
        await addNotification(client, {
          communityId: row.community_id,
          recipientUserId,
          actorUserId: null,
          kind: "COMPLETION_EXPIRED",
          eventKey: `completion-expired:${row.id}:${recipientUserId}`,
          title: "Trip confirmation window closed",
          body: "This trip was not confirmed by both participants before the window closed. Review its status in your dashboard.",
          resourceType: "RIDE_REQUEST",
          resourceId: row.id,
        });
      }
    }

    // A request still pending when the trip departed can never be accepted,
    // completed, or disputed; expire it rather than leaving it actionable.
    const abandoned = await client.query<{
      id: string;
      community_id: string;
      rider_user_id: string;
      trip_occurrence_id: string;
    }>(
      `UPDATE ride_requests r
          SET status = 'EXPIRED', updated_at = now()
        FROM trip_occurrences o
        WHERE o.id = r.trip_occurrence_id
          AND o.id = ANY($1::uuid[])
          AND r.status = 'REQUESTED'
          AND o.status <> 'CANCELLED'
          AND o.departure_at <= now()
        RETURNING r.id, r.community_id, r.rider_user_id, r.trip_occurrence_id`,
      [dueTripIds],
    );
    for (const row of abandoned.rows) {
      await addNotification(client, {
        communityId: row.community_id,
        recipientUserId: row.rider_user_id,
        actorUserId: null,
        kind: "COMPLETION_EXPIRED",
        eventKey: `request-expired:${row.id}`,
        title: "Seat request expired",
        body: "The trip departure time passed before the driver responded.",
        resourceType: "RIDE_REQUEST",
        resourceId: row.id,
      });
    }
    // Every request on these trips has now been expired or completed, so no one
    // holds a seat. Release capacity as the trip closes.
    const trips = await client.query(
      `UPDATE trip_occurrences o
          SET status = 'COMPLETED',
              seats_reserved = 0,
              updated_at = now()
        WHERE o.status = 'OPEN'
          AND o.id = ANY($1::uuid[])
          AND o.departure_at < now()
          AND NOT EXISTS (
            SELECT 1 FROM ride_requests r
             WHERE r.trip_occurrence_id = o.id AND r.status = 'ACCEPTED'
          )`,
      [dueTripIds],
    );
  return {
    requestsExpired: (expired.rowCount ?? 0) + (abandoned.rowCount ?? 0),
    tripsCompleted: trips.rowCount ?? 0,
    noShowEvidenceRecorded,
  };
}
