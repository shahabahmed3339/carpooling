import { listOpenTripDisputes } from "@/server/users/reports";
import { withActor } from "@/server/http/responses";

/**
 * Trip disputes awaiting a reviewer decision. Restricted server-side to
 * operator/safety-reviewer memberships by the service layer.
 */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ disputes: await listOpenTripDisputes(actor) }));
}
