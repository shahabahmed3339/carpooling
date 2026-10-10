/**
 * Route geometry: does a rider's leg lie along a driver's route, in the right
 * order?
 *
 * This replaces area-name matching. The product requirement is concrete: a driver
 * going Muridke -> Model Town Lahore should match a rider going Rana Town -> MAO
 * College, because the rider's leg lies along the driver's path, even though the
 * two sets of names share nothing and the rider may start many kilometres from the
 * driver.
 *
 * Proximity is the wrong tool in both directions — a small radius matches a driver
 * heading the *opposite* way, and misses a driver far along the same road. What
 * matters is (a) how far the rider's endpoints are *sideways* from the driver's
 * path, and (b) where along that path they fall.
 *
 * Everything here is plain arithmetic on an ordered list of points, deliberately:
 * it is the part of the feature most likely to be wrong in a way nobody notices
 * (a reversed route, a swapped latitude), so it is written to be readable and
 * testable rather than clever, and it needs no map provider or PostGIS extension.
 */

export type GeoPoint = { lat: number; lng: number };

/** Mean radius of the Earth in metres, used for equirectangular projection. */
const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function isValidPoint(point: unknown): point is GeoPoint {
  if (typeof point !== "object" || point === null) return false;
  const candidate = point as { lat?: unknown; lng?: unknown };
  return (
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lat) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    typeof candidate.lng === "number" &&
    Number.isFinite(candidate.lng) &&
    candidate.lng >= -180 &&
    candidate.lng <= 180
  );
}

/**
 * Metres between two points, by equirectangular approximation.
 *
 * Accurate to well under a percent over the distances this app deals with (a city
 * or an intercity commute), and far cheaper than haversine. The haversine used for
 * the old radius check is left in SQL; this one exists because the projection below
 * needs distances in a metre-based plane rather than on a sphere.
 */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const meanLat = toRadians((a.lat + b.lat) / 2);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng) * Math.cos(meanLat);
  return Math.sqrt(dLat * dLat + dLng * dLng) * EARTH_RADIUS_METERS;
}

/**
 * Convert a point into metres relative to an origin, so segment maths is done on a
 * flat plane.
 *
 * Longitude is scaled by cos(latitude) because a degree of longitude is shorter
 * the further from the equator. Ignoring that is the classic bug that makes an
 * east-west route look far longer than it is, and it scales with latitude — this
 * app's users are at ~31°N, where the error is about 15%.
 */
function toLocalMeters(point: GeoPoint, origin: GeoPoint): { x: number; y: number } {
  const x = toRadians(point.lng - origin.lng) * Math.cos(toRadians(origin.lat)) * EARTH_RADIUS_METERS;
  const y = toRadians(point.lat - origin.lat) * EARTH_RADIUS_METERS;
  return { x, y };
}

export type Projection = {
  /**
   * Perpendicular distance from the query point to the route, in metres. This is
   * "how far sideways off the route" the point is — the number the lateral
   * tolerance is compared against.
   */
  lateralMeters: number;
  /**
   * Distance in metres from the start of the route to the closest point on it.
   * Comparing two of these for a rider's endpoints answers "do they board before
   * they alight?", which is what rejects a rider travelling the other way.
   */
  alongMeters: number;
  /** Index of the route segment the point projected onto. */
  segmentIndex: number;
};

/**
 * Project a point onto a route and report how far sideways it is and how far along.
 *
 * This is the load-bearing function of the whole feature. Each segment of the route
 * is considered in turn; the projection that lands closest to the query point wins.
 * The along-distance accumulates real segment lengths up to the winner, so it is a
 * genuine distance travelled along the road rather than a straight line from the
 * origin — which matters for ranking a rider's ride length later.
 */
export function projectPointOntoRoute(point: GeoPoint, route: GeoPoint[]): Projection | null {
  if (route.length < 2) return null;

  const origin = route[0];
  const p = toLocalMeters(point, origin);

  let best: Projection | null = null;
  // Cumulative distance from the start of the route to the start of each segment.
  let cumulative = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const a = toLocalMeters(route[index], origin);
    const b = toLocalMeters(route[index + 1], origin);

    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    // A zero-length segment (a repeated point, which real provider output does
    // contain) has no direction; treat it as a point and skip the projection maths
    // that would divide by zero.
    if (segmentLength === 0) {
      cumulative += 0;
      continue;
    }

    // Project p onto the segment, clamped to [0,1] so a point beyond either end
    // measures to the endpoint rather than to an imaginary extension of the road.
    // Without the clamp, a point far off the end of the route reports a small
    // lateral distance and is wrongly treated as on-route.
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (segmentLength * segmentLength)),
    );
    const projectedX = a.x + t * (b.x - a.x);
    const projectedY = a.y + t * (b.y - a.y);
    const lateralMeters = Math.hypot(p.x - projectedX, p.y - projectedY);
    const alongMeters = cumulative + t * segmentLength;

    if (best === null || lateralMeters < best.lateralMeters) {
      best = { lateralMeters, alongMeters, segmentIndex: index };
    }

    cumulative += segmentLength;
  }

  return best;
}

/** Total length of a route in metres, following its points in order. */
export function routeLengthMeters(route: GeoPoint[]): number {
  let total = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    total += distanceMeters(route[index], route[index + 1]);
  }
  return total;
}

export type LegMatch = {
  matched: true;
  /** How far sideways the boarding and alighting points are from the route. */
  originLateralMeters: number;
  destinationLateralMeters: number;
  /** Distance along the driver's route to the rider's boarding and alighting points. */
  originAlongMeters: number;
  destinationAlongMeters: number;
  /** The rider's ride length, measured along the driver's route. */
  rideDistanceMeters: number;
  /** Total length of the driver's route, so a caller can express a detour ratio. */
  routeDistanceMeters: number;
};

export type LegMismatch = {
  matched: false;
  /**
   * Why the leg was rejected. Returned rather than a bare boolean because the
   * reasons are operationally different: "too far off the route" is a tolerance
   * question the driver could widen, whereas "wrong direction" is a genuine
   * mismatch and should never be widened into a match.
   */
  reason:
    | "ORIGIN_OFF_ROUTE"
    | "DESTINATION_OFF_ROUTE"
    | "WRONG_DIRECTION"
    | "LEG_OUTSIDE_ROUTE"
    | "DEGENERATE_LEG"
    | "ROUTE_TOO_SHORT";
};

export type LegMatchResult = LegMatch | LegMismatch;

/**
 * Decide whether a rider's leg (from `legStart` to `legEnd`) lies along a driver's
 * route, in the same direction.
 *
 * The four rules, and what each is for:
 *
 *  1. **Both endpoints are within `lateralToleranceMeters` of the route.** This is
 *     "sideways off the road". It is the number that decides whether a pickup a few
 *     streets away counts as on the route.
 *  2. **The rider boards before they alight** — `along(start) < along(end)`. This
 *     is the rule that rejects a rider travelling in the opposite direction. It is
 *     also why the driver's own route direction is enough: a leg against the flow
 *     projects to a larger along-distance at its start than at its end.
 *  3. **Both endpoints fall within the route's own extent.** A rider whose pickup
 *     projects past the driver's destination is not on this trip, however close the
 *     straight line looks.
 *  4. **The leg is not degenerate** — the two endpoints are distinct, so a rider
 *     who picked the same point twice does not "match" every driver passing it.
 *
 * Order matters: the tolerance is checked first so a genuinely off-route point is
 * reported as such rather than as a direction problem, which would be a confusing
 * thing to tell a user.
 */
export function matchLegOnRoute(input: {
  legStart: GeoPoint;
  legEnd: GeoPoint;
  route: GeoPoint[];
  lateralToleranceMeters: number;
}): LegMatchResult {
  const { legStart, legEnd, route, lateralToleranceMeters } = input;

  if (route.length < 2) return { matched: false, reason: "ROUTE_TOO_SHORT" };

  const start = projectPointOntoRoute(legStart, route);
  const end = projectPointOntoRoute(legEnd, route);
  if (start === null || end === null) return { matched: false, reason: "ROUTE_TOO_SHORT" };

  if (start.lateralMeters > lateralToleranceMeters) {
    return { matched: false, reason: "ORIGIN_OFF_ROUTE" };
  }
  if (end.lateralMeters > lateralToleranceMeters) {
    return { matched: false, reason: "DESTINATION_OFF_ROUTE" };
  }

  // A leg shorter than a metre is the same place twice; it carries no information
  // about direction, so treating it as a match would let a rider "travel" from a
  // point to itself on any route that passes it.
  const legLength = distanceMeters(legStart, legEnd);
  if (legLength < 1) return { matched: false, reason: "DEGENERATE_LEG" };

  if (end.alongMeters <= start.alongMeters) {
    // Either the rider is going the other way, or they are so close that the
    // projected order is within noise. Both are "not this trip"; reported as
    // direction because that is what the rider experiences.
    return { matched: false, reason: "WRONG_DIRECTION" };
  }

  const routeDistanceMeters = routeLengthMeters(route);
  // The route's own extent. A projection exactly at 0 is the driver's origin, which
  // is a valid pickup; one past the far end is not on this trip at all.
  if (start.alongMeters > routeDistanceMeters || end.alongMeters > routeDistanceMeters) {
    return { matched: false, reason: "LEG_OUTSIDE_ROUTE" };
  }

  return {
    matched: true,
    originLateralMeters: start.lateralMeters,
    destinationLateralMeters: end.lateralMeters,
    originAlongMeters: start.alongMeters,
    destinationAlongMeters: end.alongMeters,
    rideDistanceMeters: end.alongMeters - start.alongMeters,
    routeDistanceMeters,
  };
}

/**
 * How much of the driver's route the rider is actually on board for, 0..1.
 *
 * Used for ranking: a rider travelling most of the driver's route is a better match
 * for both parties than one hopping a single stop, and showing the best first is
 * the difference between a usable list and a wall of near-misses.
 */
export function coverageRatio(match: LegMatch): number {
  if (match.routeDistanceMeters === 0) return 0;
  return match.rideDistanceMeters / match.routeDistanceMeters;
}
