import type { PoolClient } from "pg";

export const MARKETPLACE_ID = "00000000-0000-4000-8000-000000000002";
const MARKETPLACE_NAME = "Carpool Pakistan Marketplace";

export async function ensureMarketplace(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO communities (id, name, status)
     VALUES ($1, $2, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [MARKETPLACE_ID, MARKETPLACE_NAME],
  );
  const result = await client.query<{ name: string; status: string }>(
    "SELECT name, status FROM communities WHERE id = $1",
    [MARKETPLACE_ID],
  );
  if (result.rows[0]?.name !== MARKETPLACE_NAME || result.rows[0]?.status !== "ACTIVE") {
    throw new Error("The reserved marketplace ID is already used by another record.");
  }
}
