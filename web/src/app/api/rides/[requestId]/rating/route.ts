import { submitRating } from "@/server/users/ratings";
import { HttpInputError, readJsonObject, requireUuid, withActor } from "@/server/http/responses";

/**
 * Rate the other participant on a completed trip.
 *
 * Body: `{ score: 1..5, comment?: string | null }`. There is no PUT/PATCH or
 * DELETE on purpose — a rating cannot be changed or withdrawn once submitted (the
 * database refuses both), so a contested rating is handled through the
 * trip-linked report, which a human reviews.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { requestId } = await context.params;
    const body = await readJsonObject(request);
    if (typeof body.score !== "number") throw new HttpInputError("score must be a number from 1 to 5.");
    let comment: string | null = null;
    if (body.comment !== undefined && body.comment !== null) {
      if (typeof body.comment !== "string") throw new HttpInputError("comment must be a string or null.");
      comment = body.comment;
    }
    return Response.json(
      await submitRating({
        actor,
        requestId: requireUuid(requestId, "requestId"),
        score: body.score,
        comment,
      }),
    );
  });
}
