CREATE TYPE notification_kind AS ENUM (
  'RIDE_REQUESTED',
  'RIDE_ACCEPTED',
  'RIDE_REJECTED',
  'RIDE_CANCELLED',
  'TRIP_CANCELLED',
  'COMPLETION_CONFIRMED',
  'TRIP_COMPLETED',
  'TRIP_DISPUTED',
  'COMPLETION_EXPIRED'
);

CREATE TABLE in_app_notifications (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind notification_kind NOT NULL,
  event_key text NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  resource_type text NOT NULL CHECK (resource_type IN ('RIDE_REQUEST', 'TRIP_OCCURRENCE')),
  resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX in_app_notifications_inbox_idx
  ON in_app_notifications (recipient_user_id, created_at DESC, id DESC);

CREATE INDEX in_app_notifications_unread_idx
  ON in_app_notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;
