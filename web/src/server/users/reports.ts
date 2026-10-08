import { randomUUID } from "node:crypto";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { assertActiveCommunityMember } from "@/server/community/access";
import { withIdempotency, type IdempotentResult } from "@/server/db/idempotency";
import { inTransaction } from "@/server/db/pool";
import { conflict, forbidden, invalid, notFound, rateLimited } from "@/server/rides/errors";
import type { CompletionOutcome } from "@/server/rides/completion";
import type { PoolClient } from "pg";

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

export async function reviewSafetyReport(input: {
  actor: AuthenticatedActor;
  reportId: string;
  status: Exclude<SafetyReportStatus, "RECEIVED">;
  resolutionNotes: string;
}): Promise<{ reportId: string; status: SafetyReportStatus }> {
  const resolutionNotes = input.resolutionNotes.trim();
  if (resolutionNotes.length > 2000) throw invalid("INVALID_RESOLUTION_NOTES", "Notes must be 2,000 characters or fewer.");
  return inTransaction(async (client) => {
    await assertSafetyReviewer(client, input.actor);
    const result = await client.query<{ id: string; status: SafetyReportStatus }>(
      `UPDATE safety_reports
          SET status = $3,
              assigned_to = $4,
              resolution_notes = NULLIF($5, ''),
              reviewed_at = now(),
              updated_at = now()
        WHERE id = $1 AND community_id = $2
          AND status IN ('RECEIVED', 'IN_REVIEW')
        RETURNING id, status`,
      [input.reportId, input.actor.communityId, input.status, input.actor.userId, resolutionNotes],
    );
    if (!result.rows[0]) {
      const exists = await client.query("SELECT 1 FROM safety_reports WHERE id = $1 AND community_id = $2", [input.reportId, input.actor.communityId]);
      if (exists.rowCount !== 1) throw notFound();
      throw conflict("REPORT_ALREADY_CLOSED", "This report has already been resolved or dismissed.");
    }
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
