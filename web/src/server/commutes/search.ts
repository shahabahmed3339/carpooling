import { isValidDateOnly, normalizeArea, parseClockMinutes } from "@/domain/clock";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { getPool } from "@/server/db/pool";
import { invalid } from "@/server/rides/errors";
import { assertParticipantRole } from "@/server/community/access";

export type RideCandidate = {
  commuteTemplateId: string;
  tripOccurrenceId: string;
  memberId: string;
  displayName: string;
  originArea: string;
  destinationArea: string;
  departureTime: string;
  availableSeats: number;
  departureDifferenceMinutes: number;
  contributionNote: string | null;
  /**
   * How the rider's searched area was matched to this trip's area. "EXACT" means
   * the names matched (directly or through an operator alias); "PROXIMITY" means
   * they differ and were bridged by operator-recorded coordinates. Surfaced so
   * the dashboard can say so rather than silently presenting a different pickup
   * point than the one the rider typed.
   */
  originMatch: "EXACT" | "PROXIMITY";
  destinationMatch: "EXACT" | "PROXIMITY";
};

export async function searchRideCandidates(input: {
  actor: AuthenticatedActor;
  tripDate: string;
  originArea: string;
  destinationArea: string;
  desiredDeparture: string;
  /** Must come from the authenticated server actor, never directly from request JSON. */
  timeToleranceMinutes: number;
  /**
   * How far apart two areas may be and still match, in metres. Must come from
   * server configuration, never directly from request JSON, so a client cannot
   * widen matching to every trip in the marketplace. Zero disables proximity
   * matching entirely, leaving exact/alias matching.
   */
  areaRadiusMeters: number;
}): Promise<RideCandidate[]> {
  assertParticipantRole(input.actor.participantRole, "RIDER");
  if (!isValidDateOnly(input.tripDate)) {
    throw invalid("INVALID_TRIP_DATE", "Trip date must be a valid YYYY-MM-DD date.");
  }
  if (parseClockMinutes(input.desiredDeparture) === null) {
    throw invalid("INVALID_DEPARTURE_TIME", "Departure time must use valid 24-hour HH:mm format.");
  }

  const originArea = normalizeArea(input.originArea);
  const destinationArea = normalizeArea(input.destinationArea);
  if (originArea === null) {
    throw invalid("INVALID_AREA", "Choose a valid approximate origin area.");
  }
  if (destinationArea === null) {
    throw invalid("INVALID_AREA", "Choose a valid approximate destination area.");
  }
  if (
    !Number.isInteger(input.timeToleranceMinutes) ||
    input.timeToleranceMinutes < 0 ||
    input.timeToleranceMinutes > 180
  ) {
    throw invalid("INVALID_MATCH_CONFIGURATION", "The configured time tolerance is invalid.");
  }
  if (
    !Number.isInteger(input.areaRadiusMeters) ||
    input.areaRadiusMeters < 0 ||
    input.areaRadiusMeters > 50_000
  ) {
    throw invalid("INVALID_MATCH_CONFIGURATION", "The configured area radius is invalid.");
  }

  const pool = getPool();
  const result = await pool.query<{
      commute_template_id: string;
      trip_occurrence_id: string;
      member_id: string;
      display_name: string;
      origin_area: string;
      destination_area: string;
      departure_time: string;
      available_seats: number;
      departure_difference_minutes: number;
      contribution_note: string | null;
      origin_match: "EXACT" | "PROXIMITY";
      destination_match: "EXACT" | "PROXIMITY";
    }>(
      `WITH search AS (
         SELECT $1::uuid AS community_id,
                $2::uuid AS viewer_id,
                $3::date AS trip_date,
                $4::time AS desired_departure,
                -- Resolve each side through the operator's explicit alias table.
                -- One hop only: an alias maps to a canonical area, and a
                -- canonical area is never itself an alias (enforced on insert).
                COALESCE((SELECT a.canonical_area FROM area_aliases a
                           WHERE a.community_id = $1 AND a.alias_area = $5), $5) AS origin_area,
                COALESCE((SELECT a.canonical_area FROM area_aliases a
                           WHERE a.community_id = $1 AND a.alias_area = $6), $6) AS destination_area,
                $7::integer AS tolerance_minutes,
                $8::double precision AS radius_meters,
                -- The viewer's declared coordinates for each resolved side, if an
                -- operator has recorded them. NULL means "no coordinate", which
                -- falls back to exact matching alone.
                (SELECT ac.latitude::double precision FROM area_coordinates ac
                  WHERE ac.community_id = $1
                    AND ac.area = COALESCE((SELECT a.canonical_area FROM area_aliases a
                                             WHERE a.community_id = $1 AND a.alias_area = $5), $5)
                  LIMIT 1) AS origin_latitude,
                (SELECT ac.longitude::double precision FROM area_coordinates ac
                  WHERE ac.community_id = $1
                    AND ac.area = COALESCE((SELECT a.canonical_area FROM area_aliases a
                                             WHERE a.community_id = $1 AND a.alias_area = $5), $5)
                  LIMIT 1) AS origin_longitude,
                (SELECT ac.latitude::double precision FROM area_coordinates ac
                  WHERE ac.community_id = $1
                    AND ac.area = COALESCE((SELECT a.canonical_area FROM area_aliases a
                                             WHERE a.community_id = $1 AND a.alias_area = $6), $6)
                  LIMIT 1) AS destination_latitude,
                (SELECT ac.longitude::double precision FROM area_coordinates ac
                  WHERE ac.community_id = $1
                    AND ac.area = COALESCE((SELECT a.canonical_area FROM area_aliases a
                                             WHERE a.community_id = $1 AND a.alias_area = $6), $6)
                  LIMIT 1) AS destination_longitude,
                (extract(hour FROM $4::time)::integer * 60
                  + extract(minute FROM $4::time)::integer) AS desired_minute
       )
       SELECT t.id AS commute_template_id,
              o.id AS trip_occurrence_id,
              u.id AS member_id,
              u.display_name,
              t.origin_area,
              t.destination_area,
              to_char(o.departure_at AT TIME ZONE o.timezone, 'HH24:MI') AS departure_time,
              (o.seat_capacity - o.seats_reserved)::integer AS available_seats,
              o.contribution_note,
              -- Reports which rule admitted each side, re-evaluating the same
              -- predicate the WHERE clause used. Equality/alias first; only when
              -- that is false and the distance test passed is it "PROXIMITY".
              CASE WHEN lower(regexp_replace(trim(t.origin_area), '[[:space:]]+', ' ', 'g')) = COALESCE(
                     (SELECT a.canonical_area FROM area_aliases a
                       WHERE a.community_id = s.community_id AND a.alias_area = lower(regexp_replace(trim(t.origin_area), '[[:space:]]+', ' ', 'g'))),
                     s.origin_area)
                   THEN 'EXACT' ELSE 'PROXIMITY' END AS origin_match,
              CASE WHEN lower(regexp_replace(trim(t.destination_area), '[[:space:]]+', ' ', 'g')) = COALESCE(
                     (SELECT a.canonical_area FROM area_aliases a
                       WHERE a.community_id = s.community_id AND a.alias_area = lower(regexp_replace(trim(t.destination_area), '[[:space:]]+', ' ', 'g'))),
                     s.destination_area)
                   THEN 'EXACT' ELSE 'PROXIMITY' END AS destination_match,
              CASE
                WHEN s.desired_minute < candidate.local_departure_minute
                  THEN candidate.local_departure_minute - s.desired_minute
                ELSE s.desired_minute - candidate.local_departure_minute
              END::integer AS departure_difference_minutes
         FROM search s
         JOIN trip_occurrences o
           ON o.community_id = s.community_id
          AND o.trip_date = s.trip_date
          AND o.status = 'OPEN'
          AND o.seats_reserved < o.seat_capacity
          AND o.departure_at > now()
         JOIN commute_templates t ON t.id = o.commute_template_id AND t.community_id = o.community_id
         JOIN users u ON u.id = t.owner_user_id AND u.status = 'ACTIVE'
         JOIN community_memberships m
           ON m.community_id = t.community_id
          AND m.user_id = t.owner_user_id
          AND m.status = 'ACTIVE'
         JOIN communities c ON c.id = t.community_id AND c.status = 'ACTIVE'
         CROSS JOIN LATERAL (
           SELECT (extract(hour FROM (o.departure_at AT TIME ZONE o.timezone))::integer * 60
                    + extract(minute FROM (o.departure_at AT TIME ZONE o.timezone))::integer)
                    AS local_departure_minute
         ) candidate
        WHERE t.is_active = true
          AND EXISTS (
            SELECT 1
              FROM users viewer
              JOIN community_memberships viewer_membership
                ON viewer_membership.user_id = viewer.id
             WHERE viewer.id = s.viewer_id
               AND viewer.status = 'ACTIVE'
               AND viewer_membership.community_id = s.community_id
               AND viewer_membership.status = 'ACTIVE'
          )
          AND t.role IN ('OFFERING', 'EITHER')
          AND t.seats_offered > 0
          AND t.owner_user_id <> s.viewer_id
          -- An origin/destination side matches when the resolved names are equal
          -- (exact, or via an operator alias) OR when both sides have coordinates
          -- and are within the configured radius. Proximity is a fallback: it can
          -- only widen matching between two areas an operator has placed, it
          -- never guesses a location from a name.
          AND (
            lower(regexp_replace(trim(t.origin_area), '[[:space:]]+', ' ', 'g')) = COALESCE(
                  (SELECT a.canonical_area FROM area_aliases a
                    WHERE a.community_id = s.community_id AND a.alias_area = lower(regexp_replace(trim(t.origin_area), '[[:space:]]+', ' ', 'g'))),
                  s.origin_area)
            OR area_within_radius(
                 s.community_id,
                 s.origin_latitude, s.origin_longitude,
                 lower(regexp_replace(trim(t.origin_area), '[[:space:]]+', ' ', 'g')),
                 s.radius_meters)
          )
          AND (
            lower(regexp_replace(trim(t.destination_area), '[[:space:]]+', ' ', 'g')) = COALESCE(
                  (SELECT a.canonical_area FROM area_aliases a
                    WHERE a.community_id = s.community_id AND a.alias_area = lower(regexp_replace(trim(t.destination_area), '[[:space:]]+', ' ', 'g'))),
                  s.destination_area)
            OR area_within_radius(
                 s.community_id,
                 s.destination_latitude, s.destination_longitude,
                 lower(regexp_replace(trim(t.destination_area), '[[:space:]]+', ' ', 'g')),
                 s.radius_meters)
          )
          AND abs(candidate.local_departure_minute - s.desired_minute) <= s.tolerance_minutes
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
             WHERE (b.blocker_user_id = s.viewer_id AND b.blocked_user_id = t.owner_user_id)
                OR (b.blocker_user_id = t.owner_user_id AND b.blocked_user_id = s.viewer_id)
          )
        ORDER BY departure_difference_minutes ASC,
                 (o.seat_capacity - o.seats_reserved) DESC,
                 o.id ASC
        LIMIT 25`,
      [
        input.actor.communityId,
        input.actor.userId,
        input.tripDate,
        input.desiredDeparture,
        originArea,
        destinationArea,
        input.timeToleranceMinutes,
        input.areaRadiusMeters,
      ],
    );

  return result.rows.map((row) => ({
      commuteTemplateId: row.commute_template_id,
      tripOccurrenceId: row.trip_occurrence_id,
      memberId: row.member_id,
      displayName: row.display_name,
      originArea: row.origin_area,
      destinationArea: row.destination_area,
      departureTime: row.departure_time,
      availableSeats: row.available_seats,
      departureDifferenceMinutes: row.departure_difference_minutes,
      contributionNote: row.contribution_note,
      originMatch: row.origin_match,
      destinationMatch: row.destination_match,
  }));
}
