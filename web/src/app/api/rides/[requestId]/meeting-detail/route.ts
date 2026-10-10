import { setMeetingDetail } from "@/server/rides/requests";
import { HttpInputError, readJsonObject, requireIdempotencyKey, requireUuid, withActor } from "@/server/http/responses";

/**
 * Set or clear the caller's own meeting detail for an accepted seat.
 *
 * The body is `{ detail: string | null }`. `null`, an empty string, or a
 * whitespace-only string clears it. A non-participant is refused by the service,
 * and the request's own status gate (ACCEPTED only) is enforced there too, so
 * this route does not need to re-check either.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { requestId } = await context.params;
    const body = await readJsonObject(request);
    const raw = body.detail;
    if (raw !== null && typeof raw !== "string") {
      throw new HttpInputError("detail must be a string or null.");
    }
    return Response.json(await setMeetingDetail({
      actor,
      requestId: requireUuid(requestId, "requestId"),
      detail: raw === null ? null : (raw as string),
      idempotencyKey: requireIdempotencyKey(request),
    }));
  });
}
