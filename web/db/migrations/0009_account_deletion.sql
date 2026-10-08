-- Account closure and retention.
--
-- A user can request deletion of their own account. The account is marked
-- DEACTIVATED and barred from sign-in immediately, and its personal data is
-- removed; the row is retained only as an opaque tombstone so that historical
-- records (trips, reports, idempotency receipts) keep valid foreign keys
-- without preserving who the account belonged to.

CREATE TABLE account_deletion_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  CHECK (completed_at IS NULL OR completed_at >= requested_at)
);

CREATE INDEX account_deletion_requests_user_idx
  ON account_deletion_requests (user_id, requested_at DESC);

-- Only one open request per account.
CREATE UNIQUE INDEX account_deletion_requests_open_idx
  ON account_deletion_requests (user_id)
  WHERE completed_at IS NULL;
