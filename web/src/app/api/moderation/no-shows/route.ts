import { listNoShowEvidence } from "@/server/users/reports";
import { withActor } from "@/server/http/responses";

/**
 * Unresolved completions for reviewer attention. Restricted server-side to
 * operator/safety-reviewer memberships by the service layer.
 */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ evidence: await listNoShowEvidence(actor) }));
}
