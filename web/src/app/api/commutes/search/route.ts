import { searchRideCandidates } from "@/server/commutes/search";
import { HttpInputError, readJsonObject, requiredString, withActor } from "@/server/http/responses";

const TIME_TOLERANCE_MINUTES = 20;

/**
 * How far apart two areas may be and still match, in metres. Server-controlled,
 * never read from the request, so a client cannot widen matching to every trip.
 * Zero disables proximity matching and leaves exact/alias matching only.
 */
const AREA_RADIUS_METERS = 2000;

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
      areaRadiusMeters: AREA_RADIUS_METERS,
    });
    return Response.json({ candidates });
  });
}
