import { getMyProfile, updateMyProfile } from "@/server/users/identity";
import { HttpInputError, readJsonObject, withActor } from "@/server/http/responses";

/** The caller's own profile, including the private phone and vehicle. */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json(await getMyProfile(actor)));
}

/**
 * Update the caller's own profile.
 *
 * Only the keys present in the body are touched, so a client can change the phone
 * without restating the vehicle. An explicit `vehicle: null` removes the vehicle,
 * which is how a driver stops offering a car.
 */
export async function PATCH(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);

    let displayName: string | undefined;
    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string") throw new HttpInputError("displayName must be a string.");
      displayName = body.displayName;
    }

    let phone: string | null | undefined;
    if (body.phone !== undefined) {
      if (body.phone !== null && typeof body.phone !== "string") {
        throw new HttpInputError("phone must be a string or null.");
      }
      phone = body.phone as string | null;
    }

    let vehicle: { make: string; model: string; colour: string; plate: string; seatCapacity: number } | null | undefined;
    if (body.vehicle !== undefined) {
      if (body.vehicle === null) {
        vehicle = null;
      } else {
        if (typeof body.vehicle !== "object") throw new HttpInputError("vehicle must be an object or null.");
        const v = body.vehicle as Record<string, unknown>;
        const read = (field: string): string => {
          if (typeof v[field] !== "string") throw new HttpInputError(`vehicle.${field} must be a string.`);
          return v[field] as string;
        };
        const seatCapacity = v.seatCapacity;
        if (typeof seatCapacity !== "number" || !Number.isInteger(seatCapacity)) {
          throw new HttpInputError("vehicle.seatCapacity must be a whole number.");
        }
        vehicle = {
          make: read("make"),
          model: read("model"),
          colour: read("colour"),
          plate: read("plate"),
          seatCapacity,
        };
      }
    }

    return Response.json(await updateMyProfile({ actor, displayName, phone, vehicle }));
  });
}
