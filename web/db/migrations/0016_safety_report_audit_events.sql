ALTER TABLE safety_reports
  ADD CONSTRAINT safety_reports_id_community_unique UNIQUE (id, community_id);

CREATE TABLE safety_report_events (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('SUBMITTED', 'STATUS_CHANGED', 'MIGRATION_SNAPSHOT')),
  from_status safety_report_status,
  to_status safety_report_status NOT NULL,
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (report_id, community_id)
    REFERENCES safety_reports(id, community_id) ON DELETE RESTRICT,
  CHECK (
    (event_kind IN ('SUBMITTED', 'MIGRATION_SNAPSHOT') AND from_status IS NULL)
    OR (event_kind = 'STATUS_CHANGED' AND from_status IS NOT NULL AND from_status <> to_status)
  ),
  CHECK (
    event_kind <> 'SUBMITTED' OR to_status = 'RECEIVED'
  )
);

CREATE INDEX safety_report_events_timeline_idx
  ON safety_report_events (community_id, report_id, created_at, id);

-- Earlier reports have no event history. Record only the current state and
-- label it as a snapshot so reviewers do not mistake it for a real transition.
INSERT INTO safety_report_events
  (id, community_id, report_id, actor_user_id, event_kind, from_status, to_status, notes, created_at)
SELECT md5('safety-report-snapshot:' || r.id::text)::uuid,
       r.community_id,
       r.id,
       COALESCE(r.assigned_to, r.reporter_user_id),
       'MIGRATION_SNAPSHOT',
       NULL,
       r.status,
       r.resolution_notes,
       r.updated_at
  FROM safety_reports r;
