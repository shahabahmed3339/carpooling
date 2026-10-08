import { disputeTripCompletion } from "@/server/rides/completion";
import { readJsonObject, requiredString, requireIdempotencyKey, requireUuid, withActor } from "@/server/http/responses";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { requestId } = await context.params;
    const body = await readJsonObject(request);
    return Response.json(await disputeTripCompletion({
      actor,
      requestId: requireUuid(requestId, "requestId"),
      reason: requiredString(body.reason, "reason"),
      idempotencyKey: requireIdempotencyKey(request),
    }));
  });
}
