CREATE TABLE community_invitations (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (
    email = lower(trim(email))
    AND length(email) BETWEEN 3 AND 254
    AND position('@' IN email) > 1
  ),
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_auth_subject text UNIQUE,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, email),
  CHECK (expires_at > created_at),
  CHECK ((accepted_at IS NULL) = (accepted_auth_subject IS NULL))
);

CREATE INDEX community_invitations_lookup_idx
  ON community_invitations (community_id, email, expires_at)
  WHERE revoked_at IS NULL;
