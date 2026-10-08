import { assertActiveCommunityMember } from "@/server/community/access";
import { forbidden, invalid } from "@/server/rides/errors";
import type { AuthenticatedActor, ParticipantRole } from "@/server/auth/actor";
import { inTransaction } from "@/server/db/pool";
import { lockUserActions } from "@/server/users/action-lock";

export async function updateParticipantMode(input: {
  actor: AuthenticatedActor;
  mode: ParticipantRole;
}): Promise<{ mode: ParticipantRole }> {
  if (input.mode !== "RIDER" && input.mode !== "DRIVER") {
    throw invalid("INVALID_MODE", "Choose Rider or Driver.");
  }
  return inTransaction(async (client) => {
    await lockUserActions(client, [input.actor.userId]);
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);
    const result = await client.query(
      `UPDATE users SET participant_role = $2, updated_at = now()
        WHERE id = $1 AND status = 'ACTIVE'`,
      [input.actor.userId, input.mode],
    );
    if (result.rowCount !== 1) throw forbidden();
    return { mode: input.mode };
  });
}
