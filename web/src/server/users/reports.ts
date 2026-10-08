import { randomUUID } from "node:crypto";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { assertActiveCommunityMember } from "@/server/community/access";
import { withIdempotency, type IdempotentResult } from "@/server/db/idempotency";
import { inTransaction } from "@/server/db/pool";
import { conflict, forbidden, invalid, notFound, rateLimited } from "@/server/rides/errors";
import type { CompletionOutcome } from "@/server/rides/completion";
import type { PoolClient } from "pg";
import { addNotification } from "@/server/notifications/inbox";
import { lockUserActions } from "@/server/users/action-lock";

export type SafetyReportReason = "SAFETY_CONCERN" | "HARASSMENT" | "MISREPRESENTATION" | "OTHER";
const reportReasons: SafetyReportReason[] = ["SAFETY_CONCERN", "HARASSMENT", "MISREPRESENTATION", "OTHER"];
export type SafetyReportStatus = "RECEIVED" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";

export type SafetyReportSummary = {
  reportId: string;
  reportedUserId: string;
  reportedName: string;
  tripOccurrenceId: string | null;
  reason: SafetyReportReason;
  details: string;
  status: SafetyReportStatus;
  createdAt: string;
  resolutionNotes: string | null;
};

export async function createSafetyReport(input: {
  actor: AuthenticatedActor;
  reportedUserId: string;
  tripOccurrenceId?: string;
  reason: SafetyReportReason;
  details: string;
  idempotencyKey: string;
}): Promise<IdempotentResult<{ reportId: string; status: "RECEIVED" }>> {
  const details = input.details.trim();
  if (input.reportedUserId === input.actor.userId) throw invalid("CANNOT_REPORT_SELF", "You cannot report your own account.");
  if (!reportReasons.includes(input.reason)) {
    throw invalid("INVALID_REPORT_REASON", "Choose a valid report reason.");
  }
  if (details.length < 1 || details.length > 2000) {
    throw invalid("INVALID_REPORT_DETAILS", "Describe the concern in 1 to 2,000 characters.");
  }

  return inTransaction(async (client) =>
    withIdempotency({
      client,
      actorUserId: input.actor.userId,
      operation: "safety-report.create",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({
        communityId: input.actor.communityId,
        reportedUserId: input.reportedUserId,
        tripOccurrenceId: input.tripOccurrenceId ?? null,
        reason: input.reason,
        details,
      }),
      work: async () => {
        await lockUserActions(client, [input.actor.userId, input.reportedUserId]);
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`safety-report:${input.actor.userId}`],
        );
        await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);
        await assertActiveCommunityMember(client, input.actor.communityId, input.reportedUserId);

        if (input.tripOccurrenceId) {
          const context = await client.query(
            `SELECT 1
               FROM trip_occurrences o
              WHERE o.id = $1 AND o.community_id = $2
                AND (
                  (o.driver_user_id = $4 AND EXISTS (
                    SELECT 1 FROM ride_requests r
                     WHERE r.trip_occurrence_id = o.id
                       AND r.rider_user_id = $3
                  )) OR
                  (o.driver_user_id = $3 AND EXISTS (
                    SELECT 1 FROM ride_requests r
                     WHERE r.trip_occurrence_id = o.id
                       AND r.rider_user_id = $4
                  ))
                )`,
            [input.tripOccurrenceId, input.actor.communityId, input.actor.userId, input.reportedUserId],
          );
          if (context.rowCount !== 1) throw notFound();
        }

        const recent = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM safety_reports
            WHERE reporter_user_id = $1 AND created_at > now() - interval '1 hour'`,
          [input.actor.userId],
        );
        if (Number(recent.rows[0]?.count ?? 0) >= 5) {
          throw rateLimited("REPORT_RATE_LIMIT", "You have submitted several recent reports. Try again later.");
        }

        const reportId = randomUUID();
        await client.query(
          `INSERT INTO safety_reports
             (id, community_id, reporter_user_id, reported_user_id, trip_occurrence_id, reason, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [reportId, input.actor.communityId, input.actor.userId, input.reportedUserId, input.tripOccurrenceId ?? null, input.reason, details],
        );
        await client.query(
          `INSERT INTO safety_report_events
             (id, community_id, report_id, actor_user_id, event_kind, to_status, created_at)
           VALUES ($1, $2, $3, $4, 'SUBMITTED', 'RECEIVED', clock_timestamp())`,
          [randomUUID(), input.actor.communityId, reportId, input.actor.userId],
        );
        const reviewers = await client.query<{ user_id: string }>(
          `SELECT user_id FROM community_memberships
            WHERE community_id = $1 AND status = 'ACTIVE'
              AND role IN ('OPERATOR', 'SAFETY_REVIEWER')
            ORDER BY user_id`,
          [input.actor.communityId],
        );
        for (const reviewer of reviewers.rows) {
          await addNotification(client, {
            communityId: input.actor.communityId,
            recipientUserId: reviewer.user_id,
            actorUserId: input.actor.userId,
            kind: "SAFETY_REPORT_RECEIVED",
            eventKey: `safety-report-received:${reportId}:${reviewer.user_id}`,
            title: "New safety report",
            body: "A participant submitted a report. Open the safety review queue.",
            resourceType: "SAFETY_REPORT",
            resourceId: reportId,
          });
        }
        return { status: 201, body: { reportId, status: "RECEIVED" as const } };
      },
    }),
  );
}

export async function listMySafetyReports(actor: AuthenticatedActor): Promise<SafetyReportSummary[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<SafetyReportSummary>(
      `SELECT r.id AS "reportId",
              r.reported_user_id AS "reportedUserId",
              target.display_name AS "reportedName",
              r.trip_occurrence_id AS "tripOccurrenceId",
              r.reason,
              r.details,
              r.status,
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              NULL::text AS "resolutionNotes"
         FROM safety_reports r
         JOIN users target ON target.id = r.reported_user_id
        WHERE r.community_id = $1 AND r.reporter_user_id = $2
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 100`,
      [actor.communityId, actor.userId],
    );
    return result.rows;
  });
}

async function assertSafetyReviewer(client: PoolClient, actor: AuthenticatedActor): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM community_memberships
      WHERE community_id = $1 AND user_id = $2 AND status = 'ACTIVE'
        AND role IN ('OPERATOR', 'SAFETY_REVIEWER')`,
    [actor.communityId, actor.userId],
  );
  if (result.rowCount !== 1) throw forbidden();
}

export async function listOpenSafetyReports(actor: AuthenticatedActor): Promise<SafetyReportSummary[]> {
  return inTransaction(async (client) => {
    await assertSafetyReviewer(client, actor);
    const result = await client.query<SafetyReportSummary>(
      `SELECT r.id AS "reportId",
              r.reported_user_id AS "reportedUserId",
              target.display_name AS "reportedName",
              r.trip_occurrence_id AS "tripOccurrenceId",
              r.reason,
              r.details,
              r.status,
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              r.resolution_notes AS "resolutionNotes"
         FROM safety_reports r
         JOIN users target ON target.id = r.reported_user_id
        WHERE r.community_id = $1 AND r.status IN ('RECEIVED', 'IN_REVIEW')
        ORDER BY r.created_at ASC, r.id ASC
        LIMIT 100`,
      [actor.communityId],
    );
    return result.rows;
  });
}

export async function listRecentlyClosedSafetyReports(actor: AuthenticatedActor): Promise<SafetyReportSummary[]> {
  return inTransaction(async (client) => {
    await assertSafetyReviewer(client, actor);
    const result = await client.query<SafetyReportSummary>(
      `SELECT r.id AS "reportId",
              r.reported_user_id AS "reportedUserId",
              target.display_name AS "reportedName",
              r.trip_occurrence_id AS "tripOccurrenceId",
              r.reason,
              r.details,
              r.status,
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              r.resolution_notes AS "resolutionNotes"
         FROM safety_reports r
         JOIN users target ON target.id = r.reported_user_id
        WHERE r.community_id = $1 AND r.status IN ('RESOLVED', 'DISMISSED')
        ORDER BY r.updated_at DESC, r.id DESC
        LIMIT 50`,
      [actor.communityId],
    );
    return result.rows;
  });
}

export type SafetyReportEvent = {
  eventId: string;
  eventKind: "SUBMITTED" | "STATUS_CHANGED" | "MIGRATION_SNAPSHOT";
  fromStatus: SafetyReportStatus | null;
  toStatus: SafetyReportStatus;
  actorName: string;
  notes: string | null;
  createdAt: string;
};

export async function listSafetyReportEvents(
  actor: AuthenticatedActor,
  reportId: string,
): Promise<SafetyReportEvent[]> {
  return inTransaction(async (client) => {
    await assertSafetyReviewer(client, actor);
    const result = await client.query<SafetyReportEvent>(
      `SELECT e.id AS "eventId",
              e.event_kind AS "eventKind",
              e.from_status AS "fromStatus",
              e.to_status AS "toStatus",
              CASE WHEN e.event_kind = 'MIGRATION_SNAPSHOT' THEN 'Historical snapshot'
                   ELSE actor.display_name END AS "actorName",
              e.notes,
              to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
         FROM safety_report_events e
         JOIN users actor ON actor.id = e.actor_user_id
        WHERE e.report_id = $1 AND e.community_id = $2
        ORDER BY e.created_at ASC, e.id ASC
        LIMIT 100`,
      [reportId, actor.communityId],
    );
    if (result.rowCount === 0) {
      const exists = await client.query(
        "SELECT 1 FROM safety_reports WHERE id = $1 AND community_id = $2",
        [reportId, actor.communityId],
      );
      if (exists.rowCount !== 1) throw notFound();
    }
    return result.rows;
  });
}

export async function reviewSafetyReport(input: {
  actor: AuthenticatedActor;
  reportId: string;
  status: Exclude<SafetyReportStatus, "RECEIVED">;
  resolutionNotes: string;
}): Promise<{ reportId: string; status: SafetyReportStatus; replayedOrExisting?: boolean }> {
  const resolutionNotes = input.resolutionNotes.trim();
  if (resolutionNotes.length > 2000) throw invalid("INVALID_RESOLUTION_NOTES", "Notes must be 2,000 characters or fewer.");
  return inTransaction(async (client) => {
    await lockUserActions(client, [input.actor.userId]);
    await assertSafetyReviewer(client, input.actor);
    const current = await client.query<{ status: SafetyReportStatus; reporter_user_id: string; assigned_to: string | null }>(
      `SELECT status, reporter_user_id, assigned_to
         FROM safety_reports
        WHERE id = $1 AND community_id = $2
        FOR UPDATE`,
      [input.reportId, input.actor.communityId],
    );
    const report = current.rows[0];
    if (!report) throw notFound();
    if (report.status === input.status) {
      if (input.status === "IN_REVIEW" && report.assigned_to !== input.actor.userId) {
        throw conflict("REPORT_ALREADY_ASSIGNED", "Another reviewer has started this report. Refresh the queue.");
      }
      return { reportId: input.reportId, status: report.status, replayedOrExisting: true };
    }
    if (report.status === "RESOLVED" || report.status === "DISMISSED") {
      throw conflict("REPORT_ALREADY_CLOSED", "This report has already been resolved or dismissed.");
    }
    const result = await client.query<{ id: string; status: SafetyReportStatus; reporter_user_id: string }>(
      `UPDATE safety_reports
          SET status = $3,
              assigned_to = $4,
              resolution_notes = NULLIF($5, ''),
              reviewed_at = now(),
              updated_at = now()
        WHERE id = $1 AND community_id = $2 AND status = $6
        RETURNING id, status, reporter_user_id`,
      [input.reportId, input.actor.communityId, input.status, input.actor.userId, resolutionNotes, report.status],
    );
    if (!result.rows[0]) {
      throw conflict("REPORT_CHANGED", "This report changed. Refresh the queue and try again.");
    }
    await client.query(
      `INSERT INTO safety_report_events
         (id, community_id, report_id, actor_user_id, event_kind, from_status, to_status, notes, created_at)
       VALUES ($1, $2, $3, $4, 'STATUS_CHANGED', $5, $6, NULLIF($7, ''), clock_timestamp())`,
      [randomUUID(), input.actor.communityId, input.reportId, input.actor.userId, report.status, input.status, resolutionNotes],
    );
    const statusLabel = result.rows[0].status.replaceAll("_", " ").toLowerCase();
    await addNotification(client, {
      communityId: input.actor.communityId,
      recipientUserId: result.rows[0].reporter_user_id,
      actorUserId: input.actor.userId,
      kind: "SAFETY_REPORT_STATUS_UPDATED",
      eventKey: `safety-report-status:${result.rows[0].id}:${result.rows[0].status}`,
      title: "Safety report status updated",
      body: `Your report is now ${statusLabel}. Open your reports to see its current status.`,
      resourceType: "SAFETY_REPORT",
      resourceId: result.rows[0].id,
    });
    return { reportId: result.rows[0].id, status: result.rows[0].status };
  });
}

export type NoShowEvidenceSummary = {
  requestId: string;
  outcome: CompletionOutcome;
  riderConfirmed: boolean;
  driverConfirmed: boolean;
  riderName: string;
  driverName: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departedAt: string;
  expiredAt: string;
};

/**
 * Reviewer-facing list of requests whose completion window lapsed unresolved.
 *
 * This is a signal for a human, never an automatic penalty. A lapsed
 * confirmation can mean a no-show, but it can equally mean someone travelled and
 * never reopened the app. The UI must present it as such.
 */
export async function listNoShowEvidence(actor: AuthenticatedActor): Promise<NoShowEvidenceSummary[]> {
  return inTransaction(async (client) => {
    await assertSafetyReviewer(client, actor);
    const result = await client.query<NoShowEvidenceSummary>(
      `SELECT e.ride_request_id AS "requestId",
              e.outcome,
              e.rider_confirmed AS "riderConfirmed",
              e.driver_confirmed AS "driverConfirmed",
              rider.display_name AS "riderName",
              driver.display_name AS "driverName",
              o.origin_area AS "originArea",
              o.destination_area AS "destinationArea",
              to_char(o.trip_date, 'YYYY-MM-DD') AS "tripDate",
              to_char(e.departed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "departedAt",
              to_char(e.expired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "expiredAt"
         FROM trip_no_show_evidence e
         JOIN ride_requests r ON r.id = e.ride_request_id
         JOIN trip_occurrences o
           ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
         JOIN users rider ON rider.id = r.rider_user_id
         JOIN users driver ON driver.id = o.driver_user_id
        WHERE e.community_id = $1
        ORDER BY e.expired_at DESC, e.ride_request_id
        LIMIT 100`,
      [actor.communityId],
    );
    return result.rows;
  });
}

export type TripDisputeSummary = {
  disputeId: string;
  requestId: string;
  reason: string;
  raisedByName: string;
  riderName: string;
  driverName: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departedAt: string;
  createdAt: string;
  requestStatus: "DISPUTED";
  /** Which side had confirmed the trip when the dispute was raised. */
  riderConfirmedCompletion: boolean;
  driverConfirmedCompletion: boolean;
  /** True when this request had its completion window lapse and evidence was recorded. */
  hasNoShowEvidence: boolean;
};

/**
 * Reviewer-facing queue of trip disputes that no one has resolved yet.
 *
 * A dispute means one participant said the trip did not happen as agreed. It is
 * a claim awaiting a human decision, not a finding against either side. A
 * `DISPUTED` request is never also `COMPLETED`; resolving it moves the request
 * to a terminal state.
 */
export async function listOpenTripDisputes(actor: AuthenticatedActor): Promise<TripDisputeSummary[]> {
  return inTransaction(async (client) => {
    await assertSafetyReviewer(client, actor);
    const result = await client.query<TripDisputeSummary>(
      `SELECT d.id AS "disputeId",
              d.ride_request_id AS "requestId",
              d.reason,
              raised.display_name AS "raisedByName",
              rider.display_name AS "riderName",
              driver.display_name AS "driverName",
              o.origin_area AS "originArea",
              o.destination_area AS "destinationArea",
              to_char(o.trip_date, 'YYYY-MM-DD') AS "tripDate",
              to_char(o.departure_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "departedAt",
              to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              r.status AS "requestStatus",
              r.rider_confirmed_completion AS "riderConfirmedCompletion",
              r.driver_confirmed_completion AS "driverConfirmedCompletion",
              EXISTS (
                SELECT 1 FROM trip_no_show_evidence e WHERE e.ride_request_id = r.id
              ) AS "hasNoShowEvidence"
         FROM trip_disputes d
         JOIN ride_requests r
           ON r.id = d.ride_request_id AND r.community_id = d.community_id
         JOIN trip_occurrences o
           ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
         JOIN users raised ON raised.id = d.raised_by_user_id
         JOIN users rider ON rider.id = r.rider_user_id
         JOIN users driver ON driver.id = o.driver_user_id
        WHERE d.community_id = $1
          AND d.resolved_at IS NULL
        ORDER BY d.created_at ASC, d.id ASC
        LIMIT 100`,
      [actor.communityId],
    );
    return result.rows;
  });
}

export type TripDisputeResolution = "TRIP_CONFIRMED" | "TRIP_NOT_COMPLETED";

/**
 * Resolve a trip dispute.
 *
 * The reviewer decides whether the trip happened. `TRIP_CONFIRMED` marks the
 * request `COMPLETED`; `TRIP_NOT_COMPLETED` marks it `EXPIRED`. Both are
 * terminal states in the existing `ride_request_status` enum, so resolving a
 * dispute does not require inventing a new request state. Resolving never
 * penalizes either participant automatically: it only records the decision and
 * tells both sides.
 */
export async function resolveTripDispute(input: {
  actor: AuthenticatedActor;
  disputeId: string;
  resolution: TripDisputeResolution;
  notes: string;
}): Promise<{ disputeId: string; requestId: string; requestStatus: "COMPLETED" | "EXPIRED"; replayedOrExisting?: boolean }> {
  const notes = input.notes.trim();
  if (notes.length > 2000) throw invalid("INVALID_RESOLUTION_NOTES", "Notes must be 2,000 characters or fewer.");
  if (input.resolution !== "TRIP_CONFIRMED" && input.resolution !== "TRIP_NOT_COMPLETED") {
    throw invalid("INVALID_DISPUTE_RESOLUTION", "Choose whether the trip happened.");
  }
  return inTransaction(async (client) => {
    await lockUserActions(client, [input.actor.userId]);
    await assertSafetyReviewer(client, input.actor);

    // Read the dispute to learn which trip it belongs to, then take locks in the
    // same global order every ride mutation uses (trip row, then request row) so
    // this cannot deadlock against accept/cancel/closure/completion.
    const lookup = await client.query<{ request_id: string; trip_occurrence_id: string }>(
      `SELECT d.ride_request_id AS request_id, r.trip_occurrence_id
         FROM trip_disputes d
         JOIN ride_requests r ON r.id = d.ride_request_id AND r.community_id = d.community_id
        WHERE d.id = $1 AND d.community_id = $2`,
      [input.disputeId, input.actor.communityId],
    );
    const found = lookup.rows[0];
    if (!found) throw notFound();

    await client.query(
      "SELECT 1 FROM trip_occurrences WHERE id = $1 AND community_id = $2 FOR UPDATE",
      [found.trip_occurrence_id, input.actor.communityId],
    );

    const disputeResult = await client.query<{ id: string; request_id: string; resolved_at: Date | null }>(
      `SELECT id, ride_request_id, resolved_at
         FROM trip_disputes
        WHERE id = $1 AND community_id = $2
        FOR UPDATE`,
      [input.disputeId, input.actor.communityId],
    );
    const dispute = disputeResult.rows[0];
    if (!dispute) throw notFound();

    const requestResult = await client.query<{ id: string; status: string; rider_user_id: string }>(
      `SELECT id, status, rider_user_id
         FROM ride_requests
        WHERE id = $1
        FOR UPDATE`,
      [dispute.request_id],
    );
    const request = requestResult.rows[0];
    if (!request) throw notFound();

    const nextStatus = input.resolution === "TRIP_CONFIRMED" ? "COMPLETED" : "EXPIRED";

    // Idempotent replay: a second resolution of the same dispute returns the
    // stored outcome rather than reopening or re-notifying.
    if (dispute.resolved_at !== null) {
      if (request.status === nextStatus) {
        return { disputeId: dispute.id, requestId: request.id, requestStatus: nextStatus, replayedOrExisting: true };
      }
      throw conflict("DISPUTE_ALREADY_RESOLVED", "This dispute was already resolved with a different outcome.");
    }
    if (request.status !== "DISPUTED") {
      throw conflict("REQUEST_NOT_DISPUTED", "This trip is no longer awaiting dispute review. Refresh the queue.");
    }

    const resolved = await client.query(
      `UPDATE trip_disputes
          SET resolved_at = clock_timestamp(),
              resolution = $3
        WHERE id = $1 AND community_id = $2 AND resolved_at IS NULL
        RETURNING id`,
      [dispute.id, input.actor.communityId, notes ? `${input.resolution}: ${notes}` : input.resolution],
    );
    if (resolved.rowCount !== 1) {
      throw conflict("DISPUTE_CHANGED", "This dispute changed. Refresh the queue and try again.");
    }

    const trip = await client.query<{ driver_user_id: string }>(
      "SELECT driver_user_id FROM trip_occurrences WHERE id = $1 AND community_id = $2",
      [found.trip_occurrence_id, input.actor.communityId],
    );
    const driverUserId = trip.rows[0]?.driver_user_id;
    if (!driverUserId) throw notFound();

    const moved = await client.query(
      `UPDATE ride_requests
          SET status = $3::ride_request_status,
              completed_at = CASE WHEN $3::ride_request_status = 'COMPLETED' THEN COALESCE(completed_at, clock_timestamp()) ELSE completed_at END,
              updated_at = clock_timestamp()
        WHERE id = $1 AND status = 'DISPUTED'
          AND trip_occurrence_id = $2
        RETURNING id`,
      [request.id, found.trip_occurrence_id, nextStatus],
    );
    if (moved.rowCount !== 1) {
      throw conflict("REQUEST_CHANGED", "This trip changed while resolving the dispute. Refresh the queue.");
    }

    // Notify both sides. The message states the decision, not internal notes.
    for (const recipientUserId of [request.rider_user_id, driverUserId]) {
      await addNotification(client, {
        communityId: input.actor.communityId,
        recipientUserId,
        actorUserId: input.actor.userId,
        kind: "TRIP_DISPUTE_RESOLVED",
        eventKey: `trip-dispute-resolved:${dispute.id}:${recipientUserId}:${nextStatus}`,
        title: "Trip review completed",
        body: nextStatus === "COMPLETED"
          ? "A staff member reviewed the reported issue and recorded the trip as completed."
          : "A staff member reviewed the reported issue and recorded the trip as not completed.",
        resourceType: "RIDE_REQUEST",
        resourceId: request.id,
      });
    }

    // Touch the trip's timestamp so reviewers tailing the queue see progress.
    await client.query(
      `UPDATE trip_occurrences SET updated_at = now() WHERE id = $1 AND community_id = $2`,
      [found.trip_occurrence_id, input.actor.communityId],
    );

    return { disputeId: dispute.id, requestId: request.id, requestStatus: nextStatus };
  });
}
