import type { PoolClient } from "pg";
import { forbidden } from "@/server/rides/errors";
import type { ParticipantRole } from "@/server/auth/actor";

export async function assertActiveCommunityMember(
  client: PoolClient,
  communityId: string,
  userId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM users u
       JOIN community_memberships m ON m.user_id = u.id
       JOIN communities c ON c.id = m.community_id
      WHERE u.id = $1
        AND u.status = 'ACTIVE'
        AND m.community_id = $2
        AND m.status = 'ACTIVE'
        AND c.status = 'ACTIVE'`,
    [userId, communityId],
  );
  if (result.rowCount !== 1) throw forbidden();
}

export function assertParticipantRole(
  actual: ParticipantRole,
  expected: ParticipantRole,
): void {
  if (actual !== expected) throw forbidden();
}
