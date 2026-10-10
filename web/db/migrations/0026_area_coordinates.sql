-- Geographic area coordinates, so nearby areas can match.
--
-- Areas are free text. Until now they matched only by normalized equality, plus
-- an operator-declared alias when two spellings meant one place. That still
-- cannot match "Gulberg III" to a trip leaving from "Liberty Market" two
-- kilometres away, which is a real usability gap for riders who do not know the
-- exact label the driver chose.
--
-- This migration adds the *data* for proximity matching: an operator records a
-- coordinate for an area, and search can then require two areas to be within a
-- distance of each other. It deliberately does not guess coordinates from the
-- name — a wrong guess would pair strangers who think they agreed on a meeting
-- point — and it does not replace exact/alias matching, which still wins.
--
-- Coordinates are stored in a `numeric(9,6)` pair, about 11 cm of precision,
-- which is far more than an approximate pickup area needs. Latitude and
-- longitude are constrained to valid ranges. No PostGIS dependency: matching
-- uses a plain haversine expression, and a bounding-box prefilter keeps the
-- candidate set small on the indexed columns.
CREATE TABLE area_coordinates (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  -- The same normalized form `normalizeArea` produces (trimmed, collapsed
  -- whitespace, lowercased), so a coordinate is looked up exactly like an alias.
  area text NOT NULL CHECK (length(btrim(area)) BETWEEN 1 AND 120),
  latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One coordinate per area per community; re-declaring the place updates it.
  UNIQUE (community_id, area)
);

-- Resolution is a single point lookup by (community, area).
CREATE INDEX area_coordinates_resolve_idx ON area_coordinates (community_id, area);
-- A bounding-box prefilter scans by latitude, then narrows by longitude.
CREATE INDEX area_coordinates_bbox_idx ON area_coordinates (community_id, latitude, longitude);

-- True when `area` has a recorded coordinate within `radius_meters` of the point
-- (latitude, longitude). Returns false — never an error — when any input is
-- missing, so search degrades to exact/alias matching instead of failing.
--
-- The bounding-box test runs first on the indexed latitude column, so the
-- haversine is only evaluated for the few candidates that could possibly be in
-- range. The distance is great-circle (haversine) on a spherical earth: at the
-- scale of a city this is accurate to well under a percent, which is far finer
-- than an "approximate area" warrants.
CREATE FUNCTION area_within_radius(
  p_community_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_area text,
  p_radius_meters double precision
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT
        -- Prefilter: skip rows outside a latitude band, and outside a longitude
        -- band widened by cos(latitude) so the band is not too narrow near the
        -- poles. Both bounds are cheap comparisons on the index.
        (abs(ac.latitude::double precision - p_latitude) <= (p_radius_meters / 111320.0))
        AND (abs(ac.longitude::double precision - p_longitude) <=
              (p_radius_meters / (111320.0 * GREATEST(cos(radians(p_latitude)), 0.01))))
        AND (
          2 * 6371000.0 * asin(
            sqrt(
              power(sin(radians(ac.latitude::double precision - p_latitude) / 2), 2)
              + cos(radians(p_latitude)) * cos(radians(ac.latitude::double precision))
                * power(sin(radians(ac.longitude::double precision - p_longitude) / 2), 2)
            )
          ) <= p_radius_meters
        )
        FROM area_coordinates ac
       WHERE ac.community_id = p_community_id
         AND ac.area = p_area
       LIMIT 1
    ),
    false
  )
$$;
