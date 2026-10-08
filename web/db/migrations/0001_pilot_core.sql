CREATE TYPE account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE membership_status AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');
CREATE TYPE membership_role AS ENUM ('MEMBER', 'OPERATOR', 'SAFETY_REVIEWER');
CREATE TYPE commute_role AS ENUM ('OFFERING', 'SEEKING', 'EITHER');
CREATE TYPE occurrence_status AS ENUM ('OPEN', 'CANCELLED', 'COMPLETED');
CREATE TYPE ride_request_status AS ENUM (
  'REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'DISPUTED'
);

CREATE TABLE communities (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  auth_subject text NOT NULL UNIQUE CHECK (length(auth_subject) BETWEEN 1 AND 255),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  status account_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_memberships (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status membership_status NOT NULL DEFAULT 'PENDING',
  role membership_role NOT NULL DEFAULT 'MEMBER',
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id),
  CHECK (
    (status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status IN ('ACTIVE', 'REJECTED', 'SUSPENDED') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE INDEX community_memberships_user_status_idx
  ON community_memberships (user_id, status, community_id);

CREATE TABLE user_blocks (
  blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  blocked_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_user_id, blocker_user_id);

CREATE TABLE commute_templates (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  origin_area text NOT NULL CHECK (length(trim(origin_area)) BETWEEN 1 AND 120),
  destination_area text NOT NULL CHECK (length(trim(destination_area)) BETWEEN 1 AND 120),
  departure_window_start time NOT NULL,
  departure_window_end time NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Karachi' CHECK (length(timezone) BETWEEN 1 AND 64),
  role commute_role NOT NULL,
  seats_offered smallint NOT NULL DEFAULT 0 CHECK (seats_offered BETWEEN 0 AND 8),
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (community_id, owner_user_id)
    REFERENCES community_memberships (community_id, user_id) ON DELETE RESTRICT,
  CHECK (departure_window_start <= departure_window_end),
  CHECK (
    (role = 'OFFERING' AND seats_offered > 0)
    OR (role = 'SEEKING' AND seats_offered = 0)
    OR role = 'EITHER'
  ),
  UNIQUE (id, community_id, owner_user_id)
);

CREATE INDEX commute_templates_candidate_idx
  ON commute_templates (community_id, is_active, origin_area, destination_area)
  WHERE is_active = true;

CREATE TABLE commute_template_weekdays (
  commute_template_id uuid NOT NULL REFERENCES commute_templates(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  PRIMARY KEY (commute_template_id, weekday)
);

CREATE TABLE trip_occurrences (
  id uuid PRIMARY KEY,
  commute_template_id uuid NOT NULL,
  community_id uuid NOT NULL,
  driver_user_id uuid NOT NULL,
  trip_date date NOT NULL,
  departure_at timestamptz NOT NULL,
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
  origin_area text NOT NULL CHECK (length(trim(origin_area)) BETWEEN 1 AND 120),
  destination_area text NOT NULL CHECK (length(trim(destination_area)) BETWEEN 1 AND 120),
  seat_capacity smallint NOT NULL CHECK (seat_capacity BETWEEN 1 AND 8),
  seats_reserved smallint NOT NULL DEFAULT 0 CHECK (seats_reserved >= 0),
  status occurrence_status NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (community_id, driver_user_id)
    REFERENCES community_memberships (community_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (commute_template_id, community_id, driver_user_id)
    REFERENCES commute_templates (id, community_id, owner_user_id) ON DELETE RESTRICT,
  UNIQUE (commute_template_id, trip_date),
  CHECK (seats_reserved <= seat_capacity),
  CHECK ((departure_at AT TIME ZONE timezone)::date = trip_date),
  UNIQUE (id, community_id)
);

CREATE INDEX trip_occurrences_search_idx
  ON trip_occurrences (community_id, trip_date, status, origin_area, destination_area, departure_at);

CREATE TABLE ride_requests (
  id uuid PRIMARY KEY,
  trip_occurrence_id uuid NOT NULL,
  community_id uuid NOT NULL,
  rider_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seats_requested smallint NOT NULL DEFAULT 1 CHECK (seats_requested = 1),
  status ride_request_status NOT NULL DEFAULT 'REQUESTED',
  rider_confirmed_completion boolean NOT NULL DEFAULT false,
  driver_confirmed_completion boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (trip_occurrence_id, community_id)
    REFERENCES trip_occurrences (id, community_id) ON DELETE RESTRICT,
  FOREIGN KEY (community_id, rider_user_id)
    REFERENCES community_memberships (community_id, user_id) ON DELETE RESTRICT,
  CHECK (status NOT IN ('ACCEPTED', 'COMPLETED', 'DISPUTED') OR accepted_at IS NOT NULL),
  CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND rider_confirmed_completion AND driver_confirmed_completion)),
  CHECK (status <> 'DISPUTED' OR completed_at IS NULL)
);

CREATE UNIQUE INDEX one_active_request_per_rider_occurrence
  ON ride_requests (trip_occurrence_id, rider_user_id)
  WHERE status IN ('REQUESTED', 'ACCEPTED', 'DISPUTED');

CREATE INDEX ride_requests_rider_status_idx
  ON ride_requests (rider_user_id, status, created_at DESC);

CREATE INDEX ride_requests_occurrence_status_idx
  ON ride_requests (trip_occurrence_id, status, created_at);

CREATE TABLE idempotency_records (
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 80),
  key_sha256 bytea NOT NULL CHECK (octet_length(key_sha256) = 32),
  request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
  response_status smallint,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_user_id, operation, key_sha256),
  CHECK ((response_status IS NULL) = (response_body IS NULL)),
  CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 499),
  CHECK (expires_at > created_at)
);

CREATE INDEX idempotency_records_expiry_idx ON idempotency_records (expires_at);
