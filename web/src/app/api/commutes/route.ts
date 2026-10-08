import { createCommuteTemplate, listOwnCommuteTemplates, type CommuteRole } from "@/server/commutes/templates";
import {
  jsonResult,
  HttpInputError,
  optionalString,
  readJsonObject,
  requiredInteger,
  requiredIntegerArray,
  requiredString,
  requireIdempotencyKey,
  withActor,
} from "@/server/http/responses";

const roles: CommuteRole[] = ["OFFERING", "SEEKING", "EITHER"];

export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ commutes: await listOwnCommuteTemplates(actor) }));
}

export async function POST(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    const role = requiredString(body.role, "role") as CommuteRole;
    if (!roles.includes(role)) throw new HttpInputError("role must be OFFERING, SEEKING, or EITHER.");
    return jsonResult(await createCommuteTemplate({
      actor,
      idempotencyKey: requireIdempotencyKey(request),
      commute: {
        originArea: requiredString(body.originArea, "originArea"),
        destinationArea: requiredString(body.destinationArea, "destinationArea"),
        departureWindowStart: requiredString(body.departureWindowStart, "departureWindowStart"),
        departureWindowEnd: requiredString(body.departureWindowEnd, "departureWindowEnd"),
        weekdays: requiredIntegerArray(body.weekdays, "weekdays"),
        role,
        seatsOffered: requiredInteger(body.seatsOffered, "seatsOffered"),
        contributionNote: optionalString(body.contributionNote),
      },
    }));
  });
}
