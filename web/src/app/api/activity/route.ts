import { listAccountActivity } from "@/server/rides/requests";
import { withActor } from "@/server/http/responses";

export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ activity: await listAccountActivity(actor) }));
}
