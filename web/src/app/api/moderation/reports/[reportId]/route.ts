import { listSafetyReportEvents, reviewSafetyReport, type SafetyReportStatus } from "@/server/users/reports";
import { HttpInputError, readJsonObject, requiredString, requireUuid, withActor } from "@/server/http/responses";

const reviewStatuses: Exclude<SafetyReportStatus, "RECEIVED">[] = ["IN_REVIEW", "RESOLVED", "DISMISSED"];

export async function GET(
  _request: Request,
  context: { params: Promise<{ reportId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { reportId: rawReportId } = await context.params;
    const reportId = requireUuid(rawReportId, "reportId");
    return Response.json({ events: await listSafetyReportEvents(actor, reportId) });
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ reportId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { reportId: rawReportId } = await context.params;
    const body = await readJsonObject(request);
    const status = requiredString(body.status, "status") as Exclude<SafetyReportStatus, "RECEIVED">;
    if (!reviewStatuses.includes(status)) throw new HttpInputError("Choose a valid review status.");
    return Response.json(await reviewSafetyReport({
      actor,
      reportId: requireUuid(rawReportId, "reportId"),
      status,
      resolutionNotes: typeof body.resolutionNotes === "string" ? body.resolutionNotes : "",
    }));
  });
}
