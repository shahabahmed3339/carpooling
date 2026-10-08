import { updateCommuteTemplate, type CommuteRole } from "@/server/commutes/templates";
import {
  jsonResult,
  HttpInputError,
  optionalString,
  readJsonObject,
  requiredInteger,
  requiredIntegerArray,
  requiredString,
  requireIdempotencyKey,
  requireUuid,
  withActor,
} from "@/server/http/responses";

const roles: CommuteRole[] = ["OFFERING", "SEEKING", "EITHER"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ commuteId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { commuteId } = await context.params;
    const body = await readJsonObject(request);
    const role = requiredString(body.role, "role") as CommuteRole;
    if (!roles.includes(role)) throw new HttpInputError("role must be OFFERING, SEEKING, or EITHER.");
    return jsonResult(await updateCommuteTemplate({
      actor,
      commuteTemplateId: requireUuid(commuteId, "commuteId"),
      expectedVersion: requiredInteger(body.expectedVersion, "expectedVersion"),
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
