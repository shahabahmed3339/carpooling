import { listBlockedUsers } from "@/server/users/blocks";
import { withActor } from "@/server/http/responses";

export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ blocks: await listBlockedUsers(actor) }));
}
