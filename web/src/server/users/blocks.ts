import type { AuthenticatedActor } from "@/server/auth/actor";
import type { PoolClient } from "pg";
import { assertActiveCommunityMember } from "@/server/community/access";
import { inTransaction } from "@/server/db/pool";
import { invalid } from "@/server/rides/errors";
import { lockUserActions } from "@/server/users/action-lock";

export type BlockedUser = { userId: string; displayName: string };

export async function lockUserPair(client: PoolClient, firstUserId: string, secondUserId: string): Promise<void> {
  const pairKey = [firstUserId, secondUserId].sort().join(":");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`user-pair:${pairKey}`]);
}

export async function listBlockedUsers(actor: AuthenticatedActor): Promise<BlockedUser[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<BlockedUser>(
      `SELECT u.id AS "userId", u.display_name AS "displayName"
         FROM user_blocks b
         JOIN users u ON u.id = b.blocked_user_id
        WHERE b.blocker_user_id = $1
        ORDER BY u.display_name, u.id
        LIMIT 200`,
      [actor.userId],
    );
    return result.rows;
  });
}

export async function blockUser(actor: AuthenticatedActor, targetUserId: string): Promise<{ userId: string; blocked: true }> {
  if (targetUserId === actor.userId) throw invalid("CANNOT_BLOCK_SELF", "You cannot block your own account.");
  return inTransaction(async (client) => {
    await lockUserActions(client, [actor.userId, targetUserId]);
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    await assertActiveCommunityMember(client, actor.communityId, targetUserId);
    await lockUserPair(client, actor.userId, targetUserId);
    await client.query(
      `INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`,
      [actor.userId, targetUserId],
    );
    return { userId: targetUserId, blocked: true };
  });
}

export async function unblockUser(actor: AuthenticatedActor, targetUserId: string): Promise<{ userId: string; blocked: false }> {
  return inTransaction(async (client) => {
    await lockUserActions(client, [actor.userId, targetUserId]);
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    await lockUserPair(client, actor.userId, targetUserId);
    await client.query(
      "DELETE FROM user_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2",
      [actor.userId, targetUserId],
    );
    return { userId: targetUserId, blocked: false };
  });
}
