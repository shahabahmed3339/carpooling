-- No-show evidence.
--
-- When a completion window lapses, the request becomes EXPIRED. That status
-- alone says a trip was not confirmed, but not by whom: an expired request looks
-- identical whether one side failed to confirm or neither side ever opened the
-- app. Any no-show or reliability policy needs that distinction.
--
-- This records the confirmation flags as they stood when the request expired.
-- It is deliberately evidence, not a verdict:
--   * confirming nothing is not proof a person did not travel,
--   * a single unreturned confirmation is not proof of fault, and
--   * absence of app use is not evidence of absence from the trip.
-- Nothing in the product should present this as a determination of blame.

CREATE TYPE completion_outcome AS ENUM (
  'RIDER_UNCONFIRMED',  -- driver confirmed, rider did not
  'DRIVER_UNCONFIRMED', -- rider confirmed, driver did not
  'NEITHER_CONFIRMED',  -- neither side confirmed within the window
  'BOTH_CONFIRMED'      -- both confirmed but the request did not settle
);

-- One row per request whose completion window lapsed without settlement.
CREATE TABLE trip_no_show_evidence (
  ride_request_id uuid PRIMARY KEY REFERENCES ride_requests(id) ON DELETE RESTRICT,
  community_id uuid NOT NULL,
  outcome completion_outcome NOT NULL,
  rider_confirmed boolean NOT NULL,
  driver_confirmed boolean NOT NULL,
  departed_at timestamptz NOT NULL,
  expired_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome <> 'BOTH_CONFIRMED' OR (rider_confirmed AND driver_confirmed)),
  CHECK (outcome <> 'NEITHER_CONFIRMED' OR (NOT rider_confirmed AND NOT driver_confirmed)),
  CHECK (outcome <> 'RIDER_UNCONFIRMED' OR (driver_confirmed AND NOT rider_confirmed)),
  CHECK (outcome <> 'DRIVER_UNCONFIRMED' OR (rider_confirmed AND NOT driver_confirmed))
);

CREATE INDEX trip_no_show_evidence_queue_idx
  ON trip_no_show_evidence (community_id, expired_at DESC);

-- A rider or driver with a pattern of unreturned confirmations is worth
-- surfacing to a reviewer. Read by user, so index the join path both ways.
CREATE INDEX trip_no_show_evidence_requests_idx
  ON trip_no_show_evidence (community_id, outcome, expired_at DESC);
