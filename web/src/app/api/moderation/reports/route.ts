import { listOpenSafetyReports } from "@/server/users/reports";
import { withActor } from "@/server/http/responses";

export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ reports: await listOpenSafetyReports(actor) }));
}
