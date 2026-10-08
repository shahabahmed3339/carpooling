import { searchRideCandidates } from "@/server/commutes/search";
import { HttpInputError, readJsonObject, requiredString, withActor } from "@/server/http/responses";

const TIME_TOLERANCE_MINUTES = 20;

export async function POST(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    if (body.tripDate && typeof body.tripDate !== "string") throw new HttpInputError("tripDate must be a string.");
    const candidates = await searchRideCandidates({
      actor,
      tripDate: requiredString(body.tripDate, "tripDate"),
      originArea: requiredString(body.originArea, "originArea"),
      destinationArea: requiredString(body.destinationArea, "destinationArea"),
      desiredDeparture: requiredString(body.desiredDeparture, "desiredDeparture"),
      timeToleranceMinutes: TIME_TOLERANCE_MINUTES,
    });
    return Response.json({ candidates });
  });
}
