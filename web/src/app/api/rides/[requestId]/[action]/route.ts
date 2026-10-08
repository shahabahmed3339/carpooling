import { cancelRideRequest, acceptRideRequest, rejectRideRequest } from "@/server/rides/requests";
import { jsonResult, requireIdempotencyKey, requireUuid, withActor } from "@/server/http/responses";

type Action = "accept" | "reject" | "cancel";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string; action: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { requestId: rawRequestId, action } = await context.params;
    if (!["accept", "reject", "cancel"].includes(action)) {
      return Response.json({ error: { code: "NOT_FOUND", message: "The requested action was not found." } }, { status: 404 });
    }
    const requestId = requireUuid(rawRequestId, "requestId");
    const input = { actor, requestId, idempotencyKey: requireIdempotencyKey(request) };
    const operations: Record<Action, typeof acceptRideRequest> = {
      accept: acceptRideRequest,
      reject: rejectRideRequest,
      cancel: cancelRideRequest,
    };
    return jsonResult(await operations[action as Action](input));
  });
}
