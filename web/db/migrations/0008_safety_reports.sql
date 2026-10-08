CREATE TYPE safety_report_reason AS ENUM (
  'SAFETY_CONCERN',
  'HARASSMENT',
  'MISREPRESENTATION',
  'OTHER'
);

CREATE TYPE safety_report_status AS ENUM (
  'RECEIVED',
  'IN_REVIEW',
  'RESOLVED',
  'DISMISSED'
);

CREATE TABLE safety_reports (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL,
  reporter_user_id uuid NOT NULL,
  reported_user_id uuid NOT NULL,
  trip_occurrence_id uuid,
  reason safety_report_reason NOT NULL,
  details text NOT NULL CHECK (length(trim(details)) BETWEEN 1 AND 2000),
  status safety_report_status NOT NULL DEFAULT 'RECEIVED',
  assigned_to uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolution_notes text CHECK (resolution_notes IS NULL OR length(resolution_notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  FOREIGN KEY (community_id, reporter_user_id)
    REFERENCES community_memberships (community_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (community_id, reported_user_id)
    REFERENCES community_memberships (community_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_occurrence_id, community_id)
    REFERENCES trip_occurrences (id, community_id) ON DELETE RESTRICT,
  CHECK (reporter_user_id <> reported_user_id),
  CHECK (
    (status = 'RECEIVED' AND assigned_to IS NULL AND reviewed_at IS NULL)
    OR (status <> 'RECEIVED' AND assigned_to IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX safety_reports_review_queue_idx
  ON safety_reports (community_id, status, created_at DESC);

CREATE INDEX safety_reports_reporter_idx
  ON safety_reports (reporter_user_id, created_at DESC);
