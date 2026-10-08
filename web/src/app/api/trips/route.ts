import { createTripOccurrence } from "@/server/rides/requests";
import { jsonResult, readJsonObject, requiredString, requireIdempotencyKey, requireUuid, withActor } from "@/server/http/responses";

export async function POST(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    return jsonResult(await createTripOccurrence({
      actor,
      commuteTemplateId: requireUuid(requiredString(body.commuteTemplateId, "commuteTemplateId"), "commuteTemplateId"),
      tripDate: requiredString(body.tripDate, "tripDate"),
      idempotencyKey: requireIdempotencyKey(request),
    }));
  });
}
