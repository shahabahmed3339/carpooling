import type { PoolClient } from "pg";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { assertActiveCommunityMember } from "@/server/community/access";
import { inTransaction } from "@/server/db/pool";
import { forbidden, invalid } from "@/server/rides/errors";

export type SupportSettings = {
  contact: string | null;
  hours: string | null;
};

const MAX_LENGTH = 200;

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalid("INVALID_SUPPORT_CONTACT", "Support details must be text.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_LENGTH) {
    throw invalid("INVALID_SUPPORT_CONTACT", `Support details must be ${MAX_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Read the published support contact.
 *
 * Any active member may read this: it is the point of the feature, and it gives
 * them somewhere to go when something goes wrong.
 */
export async function getSupportSettings(actor: AuthenticatedActor): Promise<SupportSettings> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<{ contact: string | null; hours: string | null }>(
      `SELECT support_contact AS contact, support_hours AS hours
         FROM communities WHERE id = $1`,
      [actor.communityId],
    );
    const row = result.rows[0];
    return { contact: row?.contact ?? null, hours: row?.hours ?? null };
  });
}

async function assertOperator(client: PoolClient, actor: AuthenticatedActor): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM community_memberships
      WHERE community_id = $1 AND user_id = $2 AND status = 'ACTIVE'
        AND role IN ('OPERATOR', 'SAFETY_REVIEWER')`,
    [actor.communityId, actor.userId],
  );
  if (result.rowCount !== 1) throw forbidden();
}

/**
 * Set or clear the published support contact.
 *
 * Only operators/reviewers may change it. An empty value clears the setting
 * rather than storing a blank string, so "not configured" stays unambiguous and
 * the UI can say so honestly instead of showing an empty contact.
 */
export async function updateSupportSettings(input: {
  actor: AuthenticatedActor;
  contact: unknown;
  hours: unknown;
}): Promise<SupportSettings> {
  const contact = clean(input.contact);
  const hours = clean(input.hours);
  return inTransaction(async (client) => {
    await assertOperator(client, input.actor);
    const updated = await client.query<{ contact: string | null; hours: string | null }>(
      `UPDATE communities
          SET support_contact = $2, support_hours = $3
        WHERE id = $1
        RETURNING support_contact AS contact, support_hours AS hours`,
      [input.actor.communityId, contact, hours],
    );
    const row = updated.rows[0];
    return { contact: row?.contact ?? null, hours: row?.hours ?? null };
  });
}
