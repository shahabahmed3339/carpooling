import { listMyAuthoredRatingRequestIds, listMyReceivedRatings } from "@/server/users/ratings";
import { withActor } from "@/server/http/responses";

/**
 * `ratings` are the ratings written about the caller. `authoredRequestIds` are the
 * requests the caller has already rated, so the dashboard can tell a completed
 * trip that still needs a rating from one that has been rated — two different
 * questions, and using the received list for both meant the form was re-offered
 * after submitting.
 */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => {
    const [ratings, authoredRequestIds] = await Promise.all([
      listMyReceivedRatings(actor),
      listMyAuthoredRatingRequestIds(actor),
    ]);
    return Response.json({ ratings, authoredRequestIds });
  });
}
