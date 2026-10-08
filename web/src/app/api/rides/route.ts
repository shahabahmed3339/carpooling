import { listRideRequests, requestSeat } from "@/server/rides/requests";
import { jsonResult, readJsonObject, requiredString, requireIdempotencyKey, requireUuid, withActor } from "@/server/http/responses";

export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ requests: await listRideRequests(actor) }));
}

export async function POST(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    return jsonResult(await requestSeat({
      actor,
      tripOccurrenceId: requireUuid(requiredString(body.tripOccurrenceId, "tripOccurrenceId"), "tripOccurrenceId"),
      idempotencyKey: requireIdempotencyKey(request),
    }));
  });
}
