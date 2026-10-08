import { confirmTripCompletion } from "@/server/rides/completion";
import { requireIdempotencyKey, requireUuid, withActor } from "@/server/http/responses";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { requestId } = await context.params;
    return Response.json(await confirmTripCompletion({
      actor,
      requestId: requireUuid(requestId, "requestId"),
      idempotencyKey: requireIdempotencyKey(request),
    }));
  });
}
