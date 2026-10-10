-- The meeting-detail notice kind.
--
-- `setMeetingDetail` notifies the other participant that a detail was shared or
-- withdrawn. The notice deliberately carries no detail text — an inbox row is
-- stored and polled broadly, so a phone number in the body would be readable
-- beyond the ride. Without this enum value the write would throw at runtime,
-- which is exactly the class of gap `npm run health-check` now detects by
-- deriving kinds from the server source.

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'MEETING_DETAIL_SHARED';
