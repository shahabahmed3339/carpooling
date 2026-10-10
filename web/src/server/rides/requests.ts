import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { inTransaction } from "@/server/db/pool";
import { withIdempotency, type IdempotentResult } from "@/server/db/idempotency";
import { assertActiveCommunityMember, assertCurrentParticipantRole, assertParticipantRole } from "@/server/community/access";
import { isValidDateOnly } from "@/domain/clock";
import { conflict, forbidden, invalid, notFound } from "./errors";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { lockUserPair } from "@/server/users/blocks";
import { expireStaleTripsIn } from "@/server/rides/completion";
import { addNotification } from "@/server/notifications/inbox";
import { lockUserActions } from "@/server/users/action-lock";

type RequestResult = {
  requestId: string;
  tripOccurrenceId: string;
  status: "REQUESTED" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  replayedOrExisting?: boolean;
};

type OccurrenceResult = {
  tripOccurrenceId: string;
  status: "OPEN" | "CANCELLED" | "COMPLETED";
  replayedOrExisting?: boolean;
};

async function usersAreBlocked(
  client: PoolClient,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> {
  // Serialize the read with block/unblock so a concurrent block cannot slip
  // between this check and creating/accepting the request.
  await lockUserPair(client, firstUserId, secondUserId);
  const result = await client.query(
    `SELECT 1
       FROM user_blocks
      WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
         OR (blocker_user_id = $2 AND blocked_user_id = $1)
      LIMIT 1`,
    [firstUserId, secondUserId],
  );
  return result.rowCount === 1;
}

export async function requestSeat(input: {
  actor: AuthenticatedActor;
  tripOccurrenceId: string;
  idempotencyKey: string;
}): Promise<IdempotentResult<RequestResult>> {
  assertParticipantRole(input.actor.participantRole, "RIDER");
  return inTransaction(async (client) => {
    // Take this account's advisory lock before the idempotency insert, so every
    // transaction uses the same order (advisory locks, then rows) and concurrent
    // requests cannot form an idempotency-row/advisory-lock cycle.
    await lockUserActions(client, [input.actor.userId]);
    return withIdempotency<RequestResult>({
      client,
      actorUserId: input.actor.userId,
      operation: "ride-request.create",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({
        communityId: input.actor.communityId,
        tripOccurrenceId: input.tripOccurrenceId,
      }),
      work: async () => {
        await assertCurrentParticipantRole(client, input.actor.userId, "RIDER");

        // Learn the driver without locking, so the advisory locks (account, then
        // pair) can all be taken before the trip ROW lock. Taking the pair lock
        // after the row lock lets concurrent requests on one trip acquire the
        // shared row first and then contend on different pair locks, which
        // Postgres resolves as a deadlock (40P01) rather than a clean outcome.
        const driverLookup = await client.query<{ driver_user_id: string }>(
          `SELECT driver_user_id FROM trip_occurrences WHERE id = $1 AND community_id = $2`,
          [input.tripOccurrenceId, input.actor.communityId],
        );
        const driverUserId = driverLookup.rows[0]?.driver_user_id;
        if (!driverUserId) throw notFound();
        await lockUserActions(client, [driverUserId]);
        const blocked = await usersAreBlocked(client, input.actor.userId, driverUserId);

        const trip = await client.query<{
          id: string;
          community_id: string;
          driver_user_id: string;
          status: "OPEN" | "CANCELLED" | "COMPLETED";
          departure_at: Date;
          seat_capacity: number;
          seats_reserved: number;
        }>(
          `SELECT t.id, t.community_id, t.driver_user_id, t.status, t.departure_at,
                  t.seat_capacity, t.seats_reserved
             FROM trip_occurrences t
             JOIN communities c ON c.id = t.community_id AND c.status = 'ACTIVE'
            WHERE t.id = $1 AND t.community_id = $2
            FOR UPDATE OF t`,
          [input.tripOccurrenceId, input.actor.communityId],
        );
        const occurrence = trip.rows[0];
        if (!occurrence) throw notFound();

        await assertActiveCommunityMember(client, occurrence.community_id, input.actor.userId);
        if (occurrence.driver_user_id === input.actor.userId) {
          throw conflict("SELF_RIDE_REQUEST", "You cannot request a seat on your own trip.");
        }
        await assertActiveCommunityMember(client, occurrence.community_id, occurrence.driver_user_id);
        // `blocked` was read under the pair lock taken before the trip row lock.
        if (blocked) {
          throw notFound();
        }
        if (occurrence.status !== "OPEN" || occurrence.departure_at <= new Date()) {
          throw conflict("TRIP_NOT_OPEN", "This trip is no longer accepting requests.");
        }
        const existing = await client.query<{
          id: string;
          status: "REQUESTED" | "ACCEPTED";
        }>(
          `SELECT id, status
             FROM ride_requests
            WHERE trip_occurrence_id = $1
              AND rider_user_id = $2
              AND status IN ('REQUESTED', 'ACCEPTED')
            LIMIT 1`,
          [occurrence.id, input.actor.userId],
        );

        if (existing.rows[0]) {
          return {
            status: 200,
            body: {
              requestId: existing.rows[0].id,
              tripOccurrenceId: occurrence.id,
              status: existing.rows[0].status,
              replayedOrExisting: true,
            },
          };
        }

        if (occurrence.seats_reserved >= occurrence.seat_capacity) {
          throw conflict("NO_SEATS_AVAILABLE", "There are no seats available for this trip.");
        }

        const requestId = randomUUID();
        await client.query(
          `INSERT INTO ride_requests (id, trip_occurrence_id, community_id, rider_user_id)
           VALUES ($1, $2, $3, $4)`,
          [requestId, occurrence.id, occurrence.community_id, input.actor.userId],
        );
        await addNotification(client, {
          communityId: occurrence.community_id,
          recipientUserId: occurrence.driver_user_id,
          actorUserId: input.actor.userId,
          kind: "RIDE_REQUESTED",
          eventKey: `ride-requested:${requestId}`,
          title: "New seat request",
          body: "A rider requested a seat. Review the request in your dashboard.",
          resourceType: "RIDE_REQUEST",
          resourceId: requestId,
        });

        return {
          status: 201,
          body: {
            requestId,
            tripOccurrenceId: occurrence.id,
            status: "REQUESTED",
          },
        };
      },
    });
  });
}

export async function createTripOccurrence(input: {
  actor: AuthenticatedActor;
  commuteTemplateId: string;
  tripDate: string;
  idempotencyKey: string;
}): Promise<IdempotentResult<OccurrenceResult>> {
  assertParticipantRole(input.actor.participantRole, "DRIVER");
  if (!isValidDateOnly(input.tripDate)) {
    throw invalid("INVALID_TRIP_DATE", "Trip date must be a valid YYYY-MM-DD date.");
  }

  return inTransaction(async (client) =>
    withIdempotency<OccurrenceResult>({
      client,
      actorUserId: input.actor.userId,
      operation: "trip-occurrence.create",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({
        communityId: input.actor.communityId,
        commuteTemplateId: input.commuteTemplateId,
        tripDate: input.tripDate,
      }),
      work: async () => {
        await lockUserActions(client, [input.actor.userId]);
        await assertCurrentParticipantRole(client, input.actor.userId, "DRIVER");
        const templateResult = await client.query<{
          id: string;
          community_id: string;
          role: "OFFERING" | "SEEKING" | "EITHER";
          seats_offered: number;
          is_active: boolean;
          community_status: string;
          membership_status: string;
        }>(
          `SELECT t.id, t.community_id, t.role, t.seats_offered, t.is_active,
                  c.status AS community_status, m.status AS membership_status
             FROM commute_templates t
             JOIN communities c ON c.id = t.community_id
             JOIN community_memberships m
               ON m.community_id = t.community_id AND m.user_id = t.owner_user_id
            WHERE t.id = $1
              AND t.community_id = $2
              AND t.owner_user_id = $3
            FOR UPDATE OF t`,
          [input.commuteTemplateId, input.actor.communityId, input.actor.userId],
        );
        const template = templateResult.rows[0];
        if (!template) throw notFound();
        if (template.community_status !== "ACTIVE" || template.membership_status !== "ACTIVE") {
          throw forbidden();
        }
        if (!template.is_active || template.role === "SEEKING" || template.seats_offered < 1) {
          throw conflict("COMMUTE_NOT_OFFERING", "This commute is not offering an available seat.");
        }

        const created = await client.query<{ id: string; status: OccurrenceResult["status"] }>(
          `INSERT INTO trip_occurrences (
             id, commute_template_id, community_id, driver_user_id, trip_date,
             departure_at, timezone, origin_area, destination_area,
             seat_capacity, seats_reserved, contribution_note
           )
           SELECT $1, t.id, t.community_id, t.owner_user_id, $3::date,
                  ($3::date + t.departure_window_start) AT TIME ZONE t.timezone,
                  t.timezone, t.origin_area, t.destination_area,
                  t.seats_offered, 0, t.contribution_note
             FROM commute_templates t
             JOIN communities c ON c.id = t.community_id AND c.status = 'ACTIVE'
             JOIN community_memberships m
               ON m.community_id = t.community_id
              AND m.user_id = t.owner_user_id
              AND m.status = 'ACTIVE'
             JOIN commute_template_weekdays d
               ON d.commute_template_id = t.id
              AND d.weekday = EXTRACT(DOW FROM $3::date)::smallint
            WHERE t.id = $2
              AND t.community_id = $4
              AND t.owner_user_id = $5
              AND t.is_active = true
              AND t.role IN ('OFFERING', 'EITHER')
              AND t.seats_offered > 0
              AND ($3::date + t.departure_window_start) AT TIME ZONE t.timezone > now()
           ON CONFLICT (commute_template_id, trip_date) DO NOTHING
           RETURNING id, status`,
          [
            randomUUID(),
            input.commuteTemplateId,
            input.tripDate,
            input.actor.communityId,
            input.actor.userId,
          ],
        );

        if (created.rows[0]) {
          return {
            status: 201,
            body: {
              tripOccurrenceId: created.rows[0].id,
              status: created.rows[0].status,
            },
          };
        }

        const existing = await client.query<{
          id: string;
          status: OccurrenceResult["status"];
        }>(
          `SELECT id, status
             FROM trip_occurrences
            WHERE commute_template_id = $1 AND trip_date = $2::date`,
          [input.commuteTemplateId, input.tripDate],
        );
        if (existing.rows[0]) {
          return {
            status: 200,
            body: {
              tripOccurrenceId: existing.rows[0].id,
              status: existing.rows[0].status,
              replayedOrExisting: true,
            },
          };
        }

        throw conflict(
          "COMMUTE_NOT_SCHEDULED",
          "The commute is not active for that date or its departure has passed.",
        );
      },
    }),
  );
}

export type CancelTripResult = {
  tripOccurrenceId: string;
  status: "CANCELLED";
  requestsWithdrawn: number;
  replayedOrExisting?: boolean;
};

/** Driver cancels a dated trip and withdraws its pending/accepted requests atomically. */
export async function cancelTripOccurrence(input: {
  actor: AuthenticatedActor;
  tripOccurrenceId: string;
  idempotencyKey: string;
}): Promise<IdempotentResult<CancelTripResult>> {
  assertParticipantRole(input.actor.participantRole, "DRIVER");
  return inTransaction(async (client) =>
    withIdempotency<CancelTripResult>({
      client,
      actorUserId: input.actor.userId,
      operation: "trip-occurrence.cancel",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({
        communityId: input.actor.communityId,
        tripOccurrenceId: input.tripOccurrenceId,
      }),
      work: async () => {
        await lockUserActions(client, [input.actor.userId]);
        await assertCurrentParticipantRole(client, input.actor.userId, "DRIVER");
        const tripResult = await client.query<{
          id: string;
          driver_user_id: string;
          status: OccurrenceResult["status"];
          departure_at: Date;
          seats_reserved: number;
        }>(
          `SELECT id, driver_user_id, status, departure_at, seats_reserved
             FROM trip_occurrences
            WHERE id = $1 AND community_id = $2
            FOR UPDATE`,
          [input.tripOccurrenceId, input.actor.communityId],
        );
        const trip = tripResult.rows[0];
        if (!trip || trip.driver_user_id !== input.actor.userId) throw notFound();
        await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);

        if (trip.status === "CANCELLED") {
          return {
            status: 200,
            body: { tripOccurrenceId: trip.id, status: "CANCELLED", requestsWithdrawn: 0, replayedOrExisting: true },
          };
        }
        if (trip.status !== "OPEN" || trip.departure_at <= new Date()) {
          throw conflict("TRIP_NOT_CANCELLABLE", "A trip can only be cancelled before it departs.");
        }

        const activeRequests = await client.query<{ id: string; rider_user_id: string; status: "REQUESTED" | "ACCEPTED" }>(
          `SELECT id, rider_user_id, status
             FROM ride_requests
            WHERE trip_occurrence_id = $1
              AND community_id = $2
              AND status IN ('REQUESTED', 'ACCEPTED')
            ORDER BY id
            FOR UPDATE`,
          [trip.id, input.actor.communityId],
        );
        const updatedRequests = await client.query(
          `UPDATE ride_requests
              SET status = 'CANCELLED', updated_at = now()
            WHERE trip_occurrence_id = $1
              AND community_id = $2
              AND status IN ('REQUESTED', 'ACCEPTED')`,
          [trip.id, input.actor.communityId],
        );
        const cancelled = await client.query(
          `UPDATE trip_occurrences
              SET status = 'CANCELLED', seats_reserved = 0, updated_at = now()
            WHERE id = $1 AND community_id = $2 AND status = 'OPEN'
            RETURNING id`,
          [trip.id, input.actor.communityId],
        );
        if (cancelled.rowCount !== 1) {
          throw conflict("TRIP_NOT_CANCELLABLE", "This trip changed. Refresh and try again.");
        }
        for (const request of activeRequests.rows) {
          await addNotification(client, {
            communityId: input.actor.communityId,
            recipientUserId: request.rider_user_id,
            actorUserId: input.actor.userId,
            kind: "TRIP_CANCELLED",
            eventKey: `trip-cancelled:${trip.id}:${request.id}`,
            title: "Trip cancelled",
            body: "The driver cancelled this trip. Your seat request was withdrawn.",
            resourceType: "TRIP_OCCURRENCE",
            resourceId: trip.id,
          });
        }

        return {
          status: 200,
          body: {
            tripOccurrenceId: trip.id,
            status: "CANCELLED",
            requestsWithdrawn: updatedRequests.rowCount ?? activeRequests.rowCount ?? 0,
          },
        };
      },
    }),
  );
}

export async function acceptRideRequest(input: {
  actor: AuthenticatedActor;
  requestId: string;
  idempotencyKey: string;
}): Promise<IdempotentResult<RequestResult>> {
  assertParticipantRole(input.actor.participantRole, "DRIVER");
  return inTransaction(async (client) => {
    // Serialize this account's mutations BEFORE the idempotency insert. All
    // concurrent accepts by the same driver otherwise each take a row lock in the
    // idempotency table and then contend on this account's advisory lock, which
    // Postgres resolves as a deadlock (40P01) — observed with four riders racing
    // for one trip, where three of four accepts failed. Taking the account lock
    // first gives every transaction the same lock order: account, then rows.
    await lockUserActions(client, [input.actor.userId]);
    return withIdempotency<RequestResult>({
      client,
      actorUserId: input.actor.userId,
      operation: "ride-request.accept",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({
        communityId: input.actor.communityId,
        requestId: input.requestId,
      }),
      work: async () => {
        await assertCurrentParticipantRole(client, input.actor.userId, "DRIVER");

        // Read the request's parent trip and rider WITHOUT locking, only to learn
        // the ids we must lock. Locking order matters: the advisory locks this
        // operation needs (account, then pair) must all be taken before the trip
        // and request ROW locks. Taking the pair lock after the trip row — as an
        // earlier version did inside usersAreBlocked — lets four concurrent
        // accepts on one trip acquire the shared trip row first and then contend
        // on different pair locks, which Postgres resolves as a deadlock (40P01)
        // instead of the intended NO_SEATS_AVAILABLE.
        const lookup = await client.query<{ trip_occurrence_id: string; rider_user_id: string }>(
          `SELECT trip_occurrence_id, rider_user_id FROM ride_requests WHERE id = $1`,
          [input.requestId],
        );
        const tripId = lookup.rows[0]?.trip_occurrence_id;
        const riderUserId = lookup.rows[0]?.rider_user_id;
        if (!tripId || !riderUserId) throw notFound();

        // All advisory locks first, in a stable order: the driver's account lock
        // (already held), the rider's account lock, then the driver/rider pair
        // lock. Nothing here takes a row lock, so this cannot invert against
        // another accept/cancel that follows the same order.
        await lockUserActions(client, [riderUserId]);
        const blocked = await usersAreBlocked(client, input.actor.userId, riderUserId);

        const tripResult = await client.query<{
          id: string;
          community_id: string;
          driver_user_id: string;
          status: "OPEN" | "CANCELLED" | "COMPLETED";
          departure_at: Date;
        }>(
          `SELECT id, community_id, driver_user_id, status, departure_at
             FROM trip_occurrences
            WHERE id = $1 AND community_id = $2
            FOR UPDATE`,
          [tripId, input.actor.communityId],
        );
        const trip = tripResult.rows[0];
        if (!trip) throw notFound();

        await assertActiveCommunityMember(client, trip.community_id, input.actor.userId);
        if (trip.driver_user_id !== input.actor.userId) throw forbidden();

        const requestResult = await client.query<{
          id: string;
          rider_user_id: string;
          status: string;
        }>(
          `SELECT id, rider_user_id, status
             FROM ride_requests
            WHERE id = $1 AND trip_occurrence_id = $2
            FOR UPDATE`,
          [input.requestId, trip.id],
        );
        const request = requestResult.rows[0];
        if (!request) throw notFound();

        if (request.status === "ACCEPTED") {
          return {
            status: 200,
            body: {
              requestId: request.id,
              tripOccurrenceId: trip.id,
              status: "ACCEPTED",
              replayedOrExisting: true,
            },
          };
        }
        if (request.status !== "REQUESTED") {
          throw conflict("REQUEST_NOT_PENDING", "This request is no longer pending.");
        }
        if (trip.status !== "OPEN" || trip.departure_at <= new Date()) {
          throw conflict("TRIP_NOT_OPEN", "This trip is no longer accepting requests.");
        }

        await assertActiveCommunityMember(client, trip.community_id, request.rider_user_id);
        // `blocked` was read under the pair lock taken before the trip row lock,
        // so a concurrent block cannot slip in between.
        if (blocked) {
          throw conflict("PARTICIPANT_BLOCKED", "This request can no longer be accepted.");
        }

        // Capacity is reserved and the request changes state in the same
        // transaction. The guarded update and row lock serialize competing
        // acceptances for a trip; the DB CHECK is the final invariant.
        const reservation = await client.query(
          `UPDATE trip_occurrences
              SET seats_reserved = seats_reserved + 1,
                  updated_at = now()
            WHERE id = $1
              AND status = 'OPEN'
              AND seats_reserved < seat_capacity
            RETURNING id`,
          [trip.id],
        );
        if (reservation.rowCount !== 1) {
          throw conflict("NO_SEATS_AVAILABLE", "There are no seats available for this trip.");
        }

        const accepted = await client.query(
          `UPDATE ride_requests
              SET status = 'ACCEPTED', accepted_at = now(), updated_at = now()
            WHERE id = $1 AND status = 'REQUESTED'
            RETURNING id`,
          [request.id],
        );
        if (accepted.rowCount !== 1) {
          throw conflict("REQUEST_NOT_PENDING", "This request is no longer pending.");
        }
        await addNotification(client, {
          communityId: trip.community_id,
          recipientUserId: request.rider_user_id,
          actorUserId: input.actor.userId,
          kind: "RIDE_ACCEPTED",
          eventKey: `ride-accepted:${request.id}`,
          title: "Seat request accepted",
          body: "The driver accepted your seat request. Check the trip in your dashboard.",
          resourceType: "RIDE_REQUEST",
          resourceId: request.id,
        });

        return {
          status: 200,
          body: {
            requestId: request.id,
            tripOccurrenceId: trip.id,
            status: "ACCEPTED",
          },
        };
      },
    });
  });
}

/** Driver declines a pending request. The trip row is always locked first. */
export async function rejectRideRequest(input: {
  actor: AuthenticatedActor;
  requestId: string;
  idempotencyKey: string;
}): Promise<IdempotentResult<RequestResult>> {
  assertParticipantRole(input.actor.participantRole, "DRIVER");
  return inTransaction(async (client) =>
    withIdempotency<RequestResult>({
      client,
      actorUserId: input.actor.userId,
      operation: "ride-request.reject",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({ communityId: input.actor.communityId, requestId: input.requestId }),
      work: async () => {
        await lockUserActions(client, [input.actor.userId]);
        await assertCurrentParticipantRole(client, input.actor.userId, "DRIVER");
        const lookup = await client.query<{ trip_occurrence_id: string }>(
          "SELECT trip_occurrence_id FROM ride_requests WHERE id = $1",
          [input.requestId],
        );
        const tripId = lookup.rows[0]?.trip_occurrence_id;
        if (!tripId) throw notFound();

        const tripResult = await client.query<{
          id: string;
          community_id: string;
          driver_user_id: string;
          status: "OPEN" | "CANCELLED" | "COMPLETED";
          departure_at: Date;
        }>(
          `SELECT id, community_id, driver_user_id, status, departure_at
             FROM trip_occurrences
            WHERE id = $1 AND community_id = $2
            FOR UPDATE`,
          [tripId, input.actor.communityId],
        );
        const trip = tripResult.rows[0];
        if (!trip) throw notFound();
        await assertActiveCommunityMember(client, trip.community_id, input.actor.userId);
        if (trip.driver_user_id !== input.actor.userId) throw forbidden();

        const requestResult = await client.query<{
          id: string;
          rider_user_id: string;
          status: RequestResult["status"];
        }>(
          `SELECT id, rider_user_id, status FROM ride_requests
            WHERE id = $1 AND trip_occurrence_id = $2 FOR UPDATE`,
          [input.requestId, trip.id],
        );
        const request = requestResult.rows[0];
        if (!request) throw notFound();
        if (request.status === "REJECTED") {
          return { status: 200, body: { requestId: request.id, tripOccurrenceId: trip.id, status: "REJECTED", replayedOrExisting: true } };
        }
        if (request.status !== "REQUESTED") {
          throw conflict("REQUEST_NOT_PENDING", "Only a pending request can be declined.");
        }
        if (trip.status !== "OPEN" || trip.departure_at <= new Date()) {
          throw conflict("TRIP_NOT_OPEN", "This trip is no longer accepting request changes.");
        }

        await client.query(
          `UPDATE ride_requests SET status = 'REJECTED', updated_at = now()
            WHERE id = $1 AND status = 'REQUESTED'`,
          [request.id],
        );
        await addNotification(client, {
          communityId: trip.community_id,
          recipientUserId: request.rider_user_id,
          actorUserId: input.actor.userId,
          kind: "RIDE_REJECTED",
          eventKey: `ride-rejected:${request.id}`,
          title: "Seat request declined",
          body: "The driver declined your seat request.",
          resourceType: "RIDE_REQUEST",
          resourceId: request.id,
        });
        return { status: 200, body: { requestId: request.id, tripOccurrenceId: trip.id, status: "REJECTED" } };
      },
    }),
  );
}

/** Rider withdraws their own pending/accepted request; accepted seats are released atomically. */
export async function cancelRideRequest(input: {
  actor: AuthenticatedActor;
  requestId: string;
  idempotencyKey: string;
}): Promise<IdempotentResult<RequestResult>> {
  assertParticipantRole(input.actor.participantRole, "RIDER");
  return inTransaction(async (client) =>
    withIdempotency<RequestResult>({
      client,
      actorUserId: input.actor.userId,
      operation: "ride-request.cancel",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({ communityId: input.actor.communityId, requestId: input.requestId }),
      work: async () => {
        await lockUserActions(client, [input.actor.userId]);
        await assertCurrentParticipantRole(client, input.actor.userId, "RIDER");
        const lookup = await client.query<{ trip_occurrence_id: string }>(
          "SELECT trip_occurrence_id FROM ride_requests WHERE id = $1",
          [input.requestId],
        );
        const tripId = lookup.rows[0]?.trip_occurrence_id;
        if (!tripId) throw notFound();

        const tripResult = await client.query<{
          id: string;
          community_id: string;
          driver_user_id: string;
          status: "OPEN" | "CANCELLED" | "COMPLETED";
          departure_at: Date;
        }>(
          `SELECT id, community_id, driver_user_id, status, departure_at FROM trip_occurrences
            WHERE id = $1 AND community_id = $2 FOR UPDATE`,
          [tripId, input.actor.communityId],
        );
        const trip = tripResult.rows[0];
        if (!trip) throw notFound();
        await assertActiveCommunityMember(client, trip.community_id, input.actor.userId);

        const requestResult = await client.query<{
          id: string;
          rider_user_id: string;
          status: RequestResult["status"];
        }>(
          `SELECT id, rider_user_id, status FROM ride_requests
            WHERE id = $1 AND trip_occurrence_id = $2 FOR UPDATE`,
          [input.requestId, trip.id],
        );
        const request = requestResult.rows[0];
        if (!request || request.rider_user_id !== input.actor.userId) throw notFound();
        if (request.status === "CANCELLED") {
          return { status: 200, body: { requestId: request.id, tripOccurrenceId: trip.id, status: "CANCELLED", replayedOrExisting: true } };
        }
        if (request.status !== "REQUESTED" && request.status !== "ACCEPTED") {
          throw conflict("REQUEST_NOT_CANCELLABLE", "This request can no longer be cancelled.");
        }
        if (trip.status !== "OPEN" || trip.departure_at <= new Date()) {
          throw conflict("TRIP_NOT_OPEN", "This trip is no longer accepting request changes.");
        }

        if (request.status === "ACCEPTED") {
          const released = await client.query(
            `UPDATE trip_occurrences SET seats_reserved = seats_reserved - 1, updated_at = now()
              WHERE id = $1 AND seats_reserved > 0 RETURNING id`,
            [trip.id],
          );
          if (released.rowCount !== 1) {
            throw conflict("CAPACITY_STATE_INVALID", "Trip capacity is temporarily unavailable. Refresh and try again.");
          }
        }
        await client.query(
          `UPDATE ride_requests SET status = 'CANCELLED', updated_at = now()
            WHERE id = $1 AND status IN ('REQUESTED', 'ACCEPTED')`,
          [request.id],
        );
        await addNotification(client, {
          communityId: trip.community_id,
          recipientUserId: trip.driver_user_id,
          actorUserId: input.actor.userId,
          kind: "RIDE_CANCELLED",
          eventKey: `ride-cancelled:${request.id}`,
          title: "Seat request cancelled",
          body: "A rider withdrew their seat request.",
          resourceType: "RIDE_REQUEST",
          resourceId: request.id,
        });
        return { status: 200, body: { requestId: request.id, tripOccurrenceId: trip.id, status: "CANCELLED" } };
      },
    }),
  );
}

export type RideRequestSummary = {
  requestId: string;
  tripOccurrenceId: string;
  status: "REQUESTED" | "ACCEPTED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "COMPLETED" | "DISPUTED";
  otherParticipantId: string;
  otherParticipantName: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  /** True once departure has passed and the trip is still confirmable. */
  awaitingCompletion: boolean;
  /** True once departure has passed, regardless of request status. */
  departurePassed: boolean;
  /** True when a reviewer resolved a dispute about this request (trip was disputed and later decided). */
  disputeResolved: boolean;
  /** The parent trip's status, so a cancelled request can be explained by who cancelled it. */
  tripStatus: "OPEN" | "CANCELLED" | "COMPLETED";
  riderConfirmedCompletion: boolean;
  driverConfirmedCompletion: boolean;
};

export type DriverTripSummary = {
  tripOccurrenceId: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  seatCapacity: number;
  seatsReserved: number;
  status: "OPEN" | "CANCELLED" | "COMPLETED";
  canCancel: boolean;
  contributionNote: string | null;
};

export type AccountActivityItem = {
  kind: "TRIP" | "REQUEST";
  recordId: string;
  tripOccurrenceId: string;
  role: "DRIVER" | "RIDER";
  status: "OPEN" | "CANCELLED" | "COMPLETED" | RideRequestSummary["status"];
  otherParticipantId: string | null;
  otherParticipantName: string | null;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  seatCapacity: number | null;
  seatsReserved: number | null;
  recordRef: string | null;
  awaitingCompletion: boolean;
  riderConfirmedCompletion: boolean;
  driverConfirmedCompletion: boolean;
};

export async function listAccountActivity(actor: AuthenticatedActor): Promise<AccountActivityItem[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    // Opportunistic housekeeping before reading: a trip whose confirmation
    // window has closed should not still read as awaiting confirmation. This is
    // the canonical sweep, so the read path also records no-show evidence and
    // settles capacity instead of diverging from it.
    await expireStaleTripsIn(client);
    const result = await client.query<AccountActivityItem>(
      `SELECT *
         FROM (
           SELECT 'TRIP'::text AS kind,
                  o.id AS "recordId",
                  o.id AS "tripOccurrenceId",
                  'DRIVER'::text AS role,
                  o.status::text AS status,
                  NULL::uuid AS "otherParticipantId",
                  NULL::text AS "otherParticipantName",
                  o.origin_area AS "originArea",
                  o.destination_area AS "destinationArea",
                  to_char(o.trip_date, 'YYYY-MM-DD') AS "tripDate",
                  to_char(o.departure_at AT TIME ZONE o.timezone, 'HH24:MI') AS "departureTime",
                  o.seat_capacity AS "seatCapacity",
                  o.seats_reserved AS "seatsReserved",
                  NULL::uuid AS "recordRef",
                  false AS "awaitingCompletion",
                  false AS "riderConfirmedCompletion",
                  false AS "driverConfirmedCompletion",
                  o.departure_at AS sort_time
             FROM trip_occurrences o
            WHERE o.community_id = $1 AND o.driver_user_id = $2

           UNION ALL

           SELECT 'REQUEST'::text AS kind,
                  r.id AS "recordId",
                  o.id AS "tripOccurrenceId",
                  CASE WHEN o.driver_user_id = $2 THEN 'DRIVER' ELSE 'RIDER' END AS role,
                  r.status::text AS status,
                  other.id AS "otherParticipantId",
                  other.display_name AS "otherParticipantName",
                  o.origin_area AS "originArea",
                  o.destination_area AS "destinationArea",
                  to_char(o.trip_date, 'YYYY-MM-DD') AS "tripDate",
                  to_char(o.departure_at AT TIME ZONE o.timezone, 'HH24:MI') AS "departureTime",
                  NULL::smallint AS "seatCapacity",
                  NULL::smallint AS "seatsReserved",
                  o.id AS "recordRef",
                  (r.status = 'ACCEPTED'
                    AND o.status <> 'CANCELLED'
                    AND o.departure_at <= now()
                    AND o.departure_at > now() - (p.completion_window)) AS "awaitingCompletion",
                  r.rider_confirmed_completion AS "riderConfirmedCompletion",
                  r.driver_confirmed_completion AS "driverConfirmedCompletion",
                  o.departure_at AS sort_time
             FROM ride_requests r
             JOIN trip_occurrences o ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
             CROSS JOIN trip_policy p
             JOIN users other ON other.id = CASE
               WHEN o.driver_user_id = $2 THEN r.rider_user_id
               ELSE o.driver_user_id
             END
            WHERE r.community_id = $1
              AND (o.driver_user_id = $2 OR r.rider_user_id = $2)
         ) activity
        ORDER BY sort_time DESC, "recordId" DESC
        LIMIT 100`,
      [actor.communityId, actor.userId],
    );
    return result.rows;
  });
}

export async function listOwnTripOccurrences(actor: AuthenticatedActor): Promise<DriverTripSummary[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<DriverTripSummary>(
      `SELECT id AS "tripOccurrenceId",
              origin_area AS "originArea",
              destination_area AS "destinationArea",
              to_char(trip_date, 'YYYY-MM-DD') AS "tripDate",
              to_char(departure_at AT TIME ZONE timezone, 'HH24:MI') AS "departureTime",
              seat_capacity AS "seatCapacity",
              seats_reserved AS "seatsReserved",
              status,
              contribution_note AS "contributionNote",
              (status = 'OPEN' AND departure_at > now()) AS "canCancel"
         FROM trip_occurrences
        WHERE community_id = $1
          AND driver_user_id = $2
          AND trip_date >= current_date
        ORDER BY departure_at ASC, id ASC
        LIMIT 50`,
      [actor.communityId, actor.userId],
    );
    return result.rows;
  });
}

export async function listRideRequests(actor: AuthenticatedActor): Promise<RideRequestSummary[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<RideRequestSummary>(
      `SELECT r.id AS "requestId",
              o.id AS "tripOccurrenceId",
              r.status,
              other.id AS "otherParticipantId",
              other.display_name AS "otherParticipantName",
              o.origin_area AS "originArea",
              o.destination_area AS "destinationArea",
              to_char(o.trip_date, 'YYYY-MM-DD') AS "tripDate",
              to_char(o.departure_at AT TIME ZONE o.timezone, 'HH24:MI') AS "departureTime",
              (r.status = 'ACCEPTED'
                AND o.status <> 'CANCELLED'
                AND o.departure_at <= now()
                AND o.departure_at > now() - (p.completion_window)) AS "awaitingCompletion",
              (o.departure_at <= now()) AS "departurePassed",
              EXISTS (
                SELECT 1 FROM trip_disputes d
                 WHERE d.ride_request_id = r.id AND d.community_id = r.community_id
                   AND d.resolved_at IS NOT NULL
              ) AS "disputeResolved",
              o.status AS "tripStatus",
              r.rider_confirmed_completion AS "riderConfirmedCompletion",
              r.driver_confirmed_completion AS "driverConfirmedCompletion"
         FROM ride_requests r
         JOIN trip_occurrences o ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
         CROSS JOIN trip_policy p
         JOIN users other ON other.id = CASE
           WHEN $3::boolean THEN r.rider_user_id
           ELSE o.driver_user_id
         END
        WHERE r.community_id = $1
          AND (($3::boolean AND o.driver_user_id = $2)
            OR (NOT $3::boolean AND r.rider_user_id = $2))
        ORDER BY o.trip_date DESC, o.departure_at DESC, r.created_at DESC
        LIMIT 50`,
      [actor.communityId, actor.userId, actor.participantRole === "DRIVER"],
    );
    return result.rows;
  });
}
