import { listMySafetyReports, createSafetyReport, type SafetyReportReason } from "@/server/users/reports";
import { HttpInputError, jsonResult, readJsonObject, requiredString, requireIdempotencyKey, requireUuid, withActor } from "@/server/http/responses";

const reasons: SafetyReportReason[] = ["SAFETY_CONCERN", "HARASSMENT", "MISREPRESENTATION", "OTHER"];

export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ reports: await listMySafetyReports(actor) }));
}

export async function POST(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    const reason = requiredString(body.reason, "reason") as SafetyReportReason;
    if (!reasons.includes(reason)) throw new HttpInputError("Choose a valid report reason.");
    const tripOccurrenceId = body.tripOccurrenceId === undefined || body.tripOccurrenceId === null || body.tripOccurrenceId === ""
      ? undefined
      : requireUuid(requiredString(body.tripOccurrenceId, "tripOccurrenceId"), "tripOccurrenceId");
    return jsonResult(await createSafetyReport({
      actor,
      reportedUserId: requireUuid(requiredString(body.reportedUserId, "reportedUserId"), "reportedUserId"),
      ...(tripOccurrenceId ? { tripOccurrenceId } : {}),
      reason,
      details: requiredString(body.details, "details"),
      idempotencyKey: requireIdempotencyKey(request),
    }));
  });
}
