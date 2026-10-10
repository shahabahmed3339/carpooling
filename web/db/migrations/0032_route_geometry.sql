-- Route geometry for along-route matching. See ROUTE_MATCHING_PLAN.md.
--
-- The current match is by area *name* (plus an optional 2 km radius). That cannot
-- express the product requirement: a driver going Muridke -> Model Town Lahore
-- should match a rider going Rana Town -> MAO College because the rider's leg lies
-- along the driver's route, even though the names share nothing and the rider may
-- live 30 km from the driver.
--
-- Proximity is the wrong tool in both directions: a 2 km radius matches a driver
-- going the opposite way, and misses a driver on the rider's exact road but far
-- along it. What is needed is the driver's actual path, and a test of whether the
-- rider's leg lies along it in the right order.
--
-- This migration stores that path. It adds:
--   * a point for each end of a commute (the map pin), while keeping the existing
--     free-text area as the human label shown in lists;
--   * the route polyline returned by a navigation provider, as an ordered array of
--     points, with the distance and duration the provider reported.
--
-- Points are `double precision` lat/lng rather than PostGIS `geometry`, because
-- PostGIS is a server extension that a managed database may not allow and the
-- operation we need (project a point onto a polyline) is a small, testable
-- computation rather than an index lookup. An `earthdistance`/GiST index for
-- "which drivers start near here" is a later, separate concern (roadmap Phase 3).
--
-- Every new column is nullable: commutes and trips that predate this keep working
-- and fall back to area-name matching, so nothing breaks mid-migration.

-- One point, used by both ends. A composite type keeps the two ends from being
-- passed around as loose loose pair of numbers and getting swapped.
CREATE TYPE geo_point AS (
  lat double precision,
  lng double precision
);

-- Latitude/longitude bounds. A transposed pair (lat 74, lng 31 for Lahore) is the
-- classic silent bug here: it produces a valid-looking but wrong point, and every
-- match silently becomes nonsense. Bounds catch the impossible; the sanity of the
-- ordering cannot be checked by the database and is the caller's job.
ALTER TABLE commute_templates
  ADD COLUMN origin_lat double precision,
  ADD COLUMN origin_lng double precision,
  ADD COLUMN destination_lat double precision,
  ADD COLUMN destination_lng double precision;

ALTER TABLE commute_templates
  ADD CONSTRAINT commute_templates_origin_point_valid CHECK (
    (origin_lat IS NULL AND origin_lng IS NULL)
    OR (origin_lat BETWEEN -90 AND 90 AND origin_lng BETWEEN -180 AND 180)
  ),
  ADD CONSTRAINT commute_templates_destination_point_valid CHECK (
    (destination_lat IS NULL AND destination_lng IS NULL)
    OR (destination_lat BETWEEN -90 AND 90 AND destination_lng BETWEEN -180 AND 180)
  ),
  -- A route needs both ends. Half a corridor cannot be matched against, and
  -- treating a missing end as "anywhere" would match every rider.
  ADD CONSTRAINT commute_templates_route_point_complete CHECK (
    (origin_lat IS NULL) = (destination_lat IS NULL)
  );

-- The decoded path. Kept in its own table rather than a column on the commute so
-- the geometry (which is large, and provider-derived) has a clear lifecycle and can
-- be refreshed without rewriting the commute row.
CREATE TABLE commute_routes (
  commute_template_id uuid PRIMARY KEY REFERENCES commute_templates (id) ON DELETE CASCADE,
  -- Ordered points from origin to destination, as JSON: [{lat, lng}, ...].
  -- A `double precision[][]` would also work; JSON is chosen because it survives
  -- a round trip through the API without ambiguity about row-major ordering, which
  -- is the failure that silently reverses a route.
  points jsonb NOT NULL,
  point_count integer NOT NULL,
  distance_meters integer NOT NULL,
  duration_seconds integer NOT NULL,
  -- Which provider produced this. Stored so a route computed by a different
  -- provider is visibly not comparable, and so a re-compute is auditable.
  provider text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT commute_routes_points_is_array CHECK (jsonb_typeof(points) = 'array'),
  -- Two points is the minimum that describes a path; one point is a location.
  CONSTRAINT commute_routes_point_count CHECK (point_count BETWEEN 2 AND 10000),
  CONSTRAINT commute_routes_distance_positive CHECK (distance_meters >= 0),
  CONSTRAINT commute_routes_duration_positive CHECK (duration_seconds >= 0),
  CONSTRAINT commute_routes_provider_length CHECK (length(btrim(provider)) BETWEEN 1 AND 40)
);

-- A published trip snapshots the geometry it was published with.
--
-- A commute is editable: the driver can change their route later. An already
-- published trip must not silently acquire the new path, or riders who matched the
-- old one would be shown a route they never agreed to. This is the same
-- copy-on-publish rule the cost-sharing note already follows.
ALTER TABLE trip_occurrences
  ADD COLUMN origin_lat double precision,
  ADD COLUMN origin_lng double precision,
  ADD COLUMN destination_lat double precision,
  ADD COLUMN destination_lng double precision,
  ADD COLUMN route_points jsonb,
  ADD COLUMN route_distance_meters integer,
  ADD COLUMN route_duration_seconds integer;

ALTER TABLE trip_occurrences
  ADD CONSTRAINT trip_occurrences_origin_point_valid CHECK (
    (origin_lat IS NULL AND origin_lng IS NULL)
    OR (origin_lat BETWEEN -90 AND 90 AND origin_lng BETWEEN -180 AND 180)
  ),
  ADD CONSTRAINT trip_occurrences_destination_point_valid CHECK (
    (destination_lat IS NULL AND destination_lng IS NULL)
    OR (destination_lat BETWEEN -90 AND 90 AND destination_lng BETWEEN -180 AND 180)
  ),
  ADD CONSTRAINT trip_occurrences_route_points_is_array CHECK (
    route_points IS NULL OR jsonb_typeof(route_points) = 'array'
  );
