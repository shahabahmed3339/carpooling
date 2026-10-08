-- Support bounded retention cleanup of old, already-read notifications.
--
-- The inbox and unread indexes serve reads. The cleanup command deletes only
-- notifications the recipient has already read and only after a retention
-- window, so it needs a partial index on read rows by age. Unread and recent
-- rows are never candidates, so they are excluded from the index.
CREATE INDEX in_app_notifications_retention_idx
  ON in_app_notifications (created_at)
  WHERE read_at IS NOT NULL;
