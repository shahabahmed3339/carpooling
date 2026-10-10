import { listAreaCoordinates, upsertAreaCoordinate } from "@/server/commutes/areas";
import { HttpInputError, optionalString, readJsonObject, requiredString, withActor } from "@/server/http/responses";

/**
 * Area coordinates are readable by any active member (they explain why a
 * proximity search matched), but only reviewer/operator accounts may change
 * them: a wrong coordinate silently mismatches riders with drivers.
 */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ coordinates: await listAreaCoordinates(actor) }));
}

function requiredCoordinate(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpInputError(`${field} must be a number.`);
  }
  return value;
}

export async function POST(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    const area = requiredString(body.area, "area");
    if (area.length > 120) throw new HttpInputError("Area names must be 120 characters or fewer.");
    const saved = await upsertAreaCoordinate({
      actor,
      area,
      latitude: requiredCoordinate(body.latitude, "latitude"),
      longitude: requiredCoordinate(body.longitude, "longitude"),
      note: optionalString(body.note),
    });
    return Response.json({ coordinate: saved }, { status: 201 });
  });
}
