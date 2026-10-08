import { resolveTripDispute, type TripDisputeResolution } from "@/server/users/reports";
import { HttpInputError, readJsonObject, requiredString, requireUuid, withActor } from "@/server/http/responses";

const resolutions: TripDisputeResolution[] = ["TRIP_CONFIRMED", "TRIP_NOT_COMPLETED"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ disputeId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { disputeId: rawDisputeId } = await context.params;
    const body = await readJsonObject(request);
    const resolution = requiredString(body.resolution, "resolution") as TripDisputeResolution;
    if (!resolutions.includes(resolution)) throw new HttpInputError("Choose whether the trip happened.");
    return Response.json(await resolveTripDispute({
      actor,
      disputeId: requireUuid(rawDisputeId, "disputeId"),
      resolution,
      notes: typeof body.notes === "string" ? body.notes : "",
    }));
  });
}
