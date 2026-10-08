ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'SAFETY_REPORT_RECEIVED';

ALTER TABLE in_app_notifications
  DROP CONSTRAINT in_app_notifications_resource_type_check;

ALTER TABLE in_app_notifications
  ADD CONSTRAINT in_app_notifications_resource_type_check
  CHECK (resource_type IN ('RIDE_REQUEST', 'TRIP_OCCURRENCE', 'SAFETY_REPORT'));
