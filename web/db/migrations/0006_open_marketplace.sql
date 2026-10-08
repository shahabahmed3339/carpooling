-- Internal tenant for the open marketplace. Users never choose or manage it.
INSERT INTO communities (id, name, status)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'Carpool Pakistan Marketplace',
  'ACTIVE'
)
ON CONFLICT (id) DO NOTHING;

-- Move existing application accounts into the shared marketplace and remove
-- the previous manual-approval gate. Membership remains an internal data scope.
INSERT INTO community_memberships
  (community_id, user_id, status, role, reviewed_by, reviewed_at)
SELECT
  '00000000-0000-4000-8000-000000000002',
  u.id,
  'ACTIVE',
  'MEMBER',
  u.id,
  now()
FROM users u
WHERE u.status = 'ACTIVE'
ON CONFLICT (community_id, user_id) DO UPDATE
  SET status = 'ACTIVE',
      role = 'MEMBER',
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = EXCLUDED.reviewed_at,
      updated_at = now();
