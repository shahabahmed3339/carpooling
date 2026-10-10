import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { inTransaction } from "@/server/db/pool";
import { assertActiveCommunityMember } from "@/server/community/access";
import { lockUserActions } from "@/server/users/action-lock";
import { conflict, forbidden, invalid, notFound } from "@/server/rides/errors";
import type { AuthenticatedActor } from "@/server/auth/actor";

/**
 * A minimum number of ratings before an average is published.
 *
 * One five-star rating is not a reputation, and showing "5.0" beside a name makes
 * a claim the data does not support. Below this count the UI is told there is no
 * score yet rather than being handed an average computed from one opinion.
 */
const MIN_RATINGS_FOR_AVERAGE = 3;

export type RatingSummary = {
  /** Null until at least MIN_RATINGS_FOR_AVERAGE ratings exist. */
  average: number | null;
  count: number;
  /** True when a score exists but is withheld for lack of volume. */
  hasEnoughForAverage: boolean;
};

export type RatingReceived = {
  ratingId: string;
  score: number;
  comment: string | null;
  createdAt: string;
  authorName: string;
  requestId: string;
};

function assertValidScore(score: unknown): asserts score is number {
  if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5) {
    throw invalid("INVALID_RATING", "Choose a rating from 1 to 5.");
  }
}

function assertValidComment(comment: string | null): void {
  if (comment === null) return;
  if (comment.length < 1 || comment.length > 500) {
    throw invalid("INVALID_RATING_COMMENT", "Keep the comment to 500 characters or fewer.");
  }
}

/**
 * Rate the other participant on a completed trip.
 *
 * The request must be `COMPLETED` and the caller must be one of its two
 * participants. Both sides may rate independently; neither can rate twice, which
 * the unique index enforces so a race cannot create two rows.
 *
 * There is deliberately no edit or delete path — see the migration. A rating is a
 * record, and the safety-report route is the way to contest one.
 */
export async function submitRating(input: {
  actor: AuthenticatedActor;
  requestId: string;
  score: number;
  comment: string | null;
}): Promise<{ ratingId: string; subjectUserId: string }> {
  assertValidScore(input.score);
  const trimmed = input.comment === null ? null : input.comment.trim();
  const comment = trimmed === null || trimmed.length === 0 ? null : trimmed;
  assertValidComment(comment);

  return inTransaction(async (client) => {
    await lockUserActions(client, [input.actor.userId]);
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);

    // Lock the trip before the request, the same global order every ride mutation
    // uses, so this cannot deadlock against accept/cancel/completion.
    const lookup = await client.query<{ trip_occurrence_id: string; rider_user_id: string; status: string }>(
      `SELECT r.trip_occurrence_id, r.rider_user_id, r.status
         FROM ride_requests r
        WHERE r.id = $1 AND r.community_id = $2`,
      [input.requestId, input.actor.communityId],
    );
    const found = lookup.rows[0];
    if (!found) throw notFound();

    await client.query(
      "SELECT 1 FROM trip_occurrences WHERE id = $1 AND community_id = $2 FOR UPDATE",
      [found.trip_occurrence_id, input.actor.communityId],
    );
    const trip = await client.query<{ driver_user_id: string }>(
      "SELECT driver_user_id FROM trip_occurrences WHERE id = $1 AND community_id = $2",
      [found.trip_occurrence_id, input.actor.communityId],
    );
    const driverUserId = trip.rows[0]?.driver_user_id;
    if (!driverUserId) throw notFound();

    // Participant check before the status check, so a non-participant cannot
    // probe a request's state by the error they receive.
    const isRider = found.rider_user_id === input.actor.userId;
    const isDriver = driverUserId === input.actor.userId;
    if (!isRider && !isDriver) throw forbidden();
    if (found.status !== "COMPLETED") {
      throw conflict("REQUEST_NOT_COMPLETED", "You can rate a trip only once it is completed.");
    }

    const subjectUserId = isDriver ? found.rider_user_id : driverUserId;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO trip_ratings
         (id, community_id, ride_request_id, author_user_id, subject_user_id, score, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ride_request_id, author_user_id) DO NOTHING
       RETURNING id`,
      [randomUUID(), input.actor.communityId, input.requestId, input.actor.userId, subjectUserId, input.score, comment],
    );
    // A second rating is a conflict, not a silent overwrite: the immutability
    // rule is easier to trust when a duplicate is refused with a reason.
    if (inserted.rowCount !== 1) {
      throw conflict("ALREADY_RATED", "You have already rated this trip.");
    }
    return { ratingId: inserted.rows[0].id, subjectUserId };
  });
}

/**
 * The aggregate a name is shown with, plus whether the caller has already rated
 * the given request — so the dashboard can show a form or a thank-you without a
 * second round trip.
 */
export async function getRatingSummary(input: {
  actor: AuthenticatedActor;
  subjectUserId: string;
}): Promise<RatingSummary & { myRatingForSubjectOnRequest: null }> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);
    const result = await client.query<{ total: string; count: string }>(
      `SELECT COALESCE(sum(score), 0)::text AS total, count(*)::text AS count
         FROM trip_ratings
        WHERE community_id = $1 AND subject_user_id = $2`,
      [input.actor.communityId, input.subjectUserId],
    );
    const count = Number(result.rows[0]?.count ?? 0);
    const total = Number(result.rows[0]?.total ?? 0);
    const hasEnoughForAverage = count >= MIN_RATINGS_FOR_AVERAGE;
    return {
      average: hasEnoughForAverage && count > 0 ? Math.round((total / count) * 10) / 10 : null,
      count,
      hasEnoughForAverage,
      myRatingForSubjectOnRequest: null,
    };
  });
}

/**
 * Ratings written about the caller, newest first, with the author's name.
 *
 * The comment is included: it is the part a person can act on. It is free text
 * with no moderation — the trip-linked report is the way to raise something that
 * needs a human, and reviews are not a support channel.
 */
export async function listMyReceivedRatings(
  actor: AuthenticatedActor,
  limit = 50,
): Promise<RatingReceived[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<RatingReceived>(
      `SELECT r.id AS "ratingId",
              r.score,
              r.comment,
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              u.display_name AS "authorName",
              r.ride_request_id AS "requestId"
         FROM trip_ratings r
         JOIN users u ON u.id = r.author_user_id
        WHERE r.community_id = $1 AND r.subject_user_id = $2
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $3`,
      [actor.communityId, actor.userId, Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows;
  });
}

/**
 * The request ids the caller has already rated.
 *
 * Distinct from `listMyReceivedRatings`, which returns ratings *about* the caller.
 * The dashboard needs both: the list to show what others said, and this set to
 * know which completed trips still need a rating from this account. Using the
 * received list for the second purpose was a bug — a rating the caller wrote
 * appears in the recipient's list, not theirs, so the form was offered again
 * after submitting (the server refused it, but offering a form that cannot be
 * sent is a worse experience than showing that it was already rated).
 */
export async function listMyAuthoredRatingRequestIds(actor: AuthenticatedActor): Promise<string[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<{ requestId: string }>(
      "SELECT ride_request_id AS \"requestId\" FROM trip_ratings WHERE community_id = $1 AND author_user_id = $2",
      [actor.communityId, actor.userId],
    );
    return result.rows.map((row) => row.requestId);
  });
}

/** Whether the caller has already rated the other side of one request. */
export async function hasRatedRequest(client: PoolClient, requestId: string, authorUserId: string): Promise<boolean> {
  const result = await client.query(
    "SELECT 1 FROM trip_ratings WHERE ride_request_id = $1 AND author_user_id = $2 LIMIT 1",
    [requestId, authorUserId],
  );
  return result.rowCount === 1;
}

/** A compact rating summary for a set of subjects, for list rendering. */
export async function summariseRatingsFor(client: PoolClient, communityId: string, subjectUserIds: string[]): Promise<Map<string, RatingSummary>> {
  const summaries = new Map<string, RatingSummary>();
  if (subjectUserIds.length === 0) return summaries;
  const result = await client.query<{ subject: string; total: string; count: string }>(
    `SELECT subject_user_id::text AS subject, COALESCE(sum(score),0)::text AS total, count(*)::text AS count
       FROM trip_ratings
      WHERE community_id = $1 AND subject_user_id = ANY($2::uuid[])
      GROUP BY subject_user_id`,
    [communityId, subjectUserIds],
  );
  for (const row of result.rows) {
    const count = Number(row.count);
    const total = Number(row.total);
    const hasEnoughForAverage = count >= MIN_RATINGS_FOR_AVERAGE;
    summaries.set(row.subject, {
      average: hasEnoughForAverage && count > 0 ? Math.round((total / count) * 10) / 10 : null,
      count,
      hasEnoughForAverage,
    });
  }
  return summaries;
}
