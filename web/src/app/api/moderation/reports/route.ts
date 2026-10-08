import { listOpenSafetyReports, listRecentlyClosedSafetyReports } from "@/server/users/reports";
import { withActor } from "@/server/http/responses";

export async function GET(): Promise<Response> {
  return withActor(async (actor) => {
    const [reports, closedReports] = await Promise.all([
      listOpenSafetyReports(actor),
      listRecentlyClosedSafetyReports(actor),
    ]);
    return Response.json({ reports, closedReports });
  });
}
