import type { PoolClient } from "pg";

/** Serialize account-owned mutations with account closure and mode changes.
 * For multi-account operations, pass every affected ID at once; sorted order
 * prevents account-lock deadlocks. Always acquire these before trip/request
 * row locks to keep a consistent lock order. */
export async function lockUserActions(client: PoolClient, userIds: string[]): Promise<void> {
  const ordered = [...new Set(userIds)].sort();
  for (const userId of ordered) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`account-action:${userId}`],
    );
  }
}
