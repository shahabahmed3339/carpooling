import { cancelTripOccurrence } from "@/server/rides/requests";
import { jsonResult, requireIdempotencyKey, requireUuid, withActor } from "@/server/http/responses";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { tripId: rawTripId } = await context.params;
    return jsonResult(await cancelTripOccurrence({
      actor,
      tripOccurrenceId: requireUuid(rawTripId, "tripId"),
      idempotencyKey: requireIdempotencyKey(request),
    }));
  });
}
