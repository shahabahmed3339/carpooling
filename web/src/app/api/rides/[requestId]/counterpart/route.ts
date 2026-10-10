import { getCounterpartIdentity } from "@/server/users/identity";
import { requireUuid, withActor } from "@/server/http/responses";

/**
 * The other participant's identity for one request — name, phone, vehicle.
 *
 * Returns `{ identity: null }` rather than `404` when the caller is not a
 * participant or the request is not accepted: a distinct status would tell a
 * stranger whether a given request exists and carries a phone number. The service
 * enforces both conditions; this route adds no separate check.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { requestId } = await context.params;
    const identity = await getCounterpartIdentity({
      actor,
      requestId: requireUuid(requestId, "requestId"),
    });
    return Response.json({ identity });
  });
}
