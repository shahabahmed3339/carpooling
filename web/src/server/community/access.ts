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

/** Recheck a mode-gated write after taking the user's account-action lock. */
export async function assertCurrentParticipantRole(
  client: PoolClient,
  userId: string,
  expected: ParticipantRole,
): Promise<void> {
  const result = await client.query<{ participant_role: ParticipantRole }>(
    `SELECT participant_role FROM users
      WHERE id = $1 AND status = 'ACTIVE'
      FOR UPDATE`,
    [userId],
  );
  if (result.rows[0]?.participant_role !== expected) throw forbidden();
}

export function assertParticipantRole(
  actual: ParticipantRole,
  expected: ParticipantRole,
): void {
  if (actual !== expected) throw forbidden();
}
