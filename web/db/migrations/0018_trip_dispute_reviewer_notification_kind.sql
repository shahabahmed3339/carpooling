-- Reviewer inbox notice kind for a newly reported trip dispute.
--
-- `TRIP_DISPUTED` already notifies the other participant. Reusing it for the
-- reviewer notice made the dashboard offer a "view on dashboard" link that the
-- reviewer has no matching record for, so the reviewer notice gets its own kind
-- and can link to the moderation queue instead.
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'TRIP_DISPUTE_REVIEW_REQUESTED';
