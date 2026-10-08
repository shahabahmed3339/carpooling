-- Trip completion, no-show, and expiry.
--
-- A published trip previously stayed OPEN forever after departure, so a
-- finished ride and an abandoned one were indistinguishable. Completion is
-- per-side: a rider and a driver each confirm independently, and the request
-- only becomes COMPLETED when both have confirmed. A dispute is recorded when
-- the two sides disagree.

-- Bound how long after departure a trip stays confirmable, and when an
-- unconfirmed trip is treated as expired. A single configurable value keeps the
-- window in one place rather than scattered through application code.
CREATE TABLE trip_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  completion_window interval NOT NULL DEFAULT interval '24 hours'
    CHECK (completion_window BETWEEN interval '1 hour' AND interval '14 days'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO trip_policy (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Record who disputed and why, without disturbing the request row's state.
CREATE TABLE trip_disputes (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL,
  ride_request_id uuid NOT NULL REFERENCES ride_requests(id) ON DELETE RESTRICT,
  raised_by_user_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text CHECK (resolution IS NULL OR length(resolution) <= 1000),
  UNIQUE (ride_request_id, raised_by_user_id)
);

CREATE INDEX trip_disputes_open_idx
  ON trip_disputes (community_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- Support sweeping trips past their completion window.
CREATE INDEX trip_occurrences_completion_sweep_idx
  ON trip_occurrences (status, departure_at)
  WHERE status = 'OPEN';

CREATE INDEX ride_requests_completion_sweep_idx
  ON ride_requests (status, updated_at)
  WHERE status IN ('REQUESTED', 'ACCEPTED');

-- Convenience: a trip's outstanding confirmations can be read without a join
-- fan-out.
CREATE INDEX ride_requests_trip_completion_idx
  ON ride_requests (trip_occurrence_id)
  WHERE status = 'ACCEPTED';
