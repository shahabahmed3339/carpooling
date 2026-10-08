import { blockUser, unblockUser } from "@/server/users/blocks";
import { requireUuid, withActor } from "@/server/http/responses";

export async function POST(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { userId } = await context.params;
    return Response.json(await blockUser(actor, requireUuid(userId, "userId")));
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { userId } = await context.params;
    return Response.json(await unblockUser(actor, requireUuid(userId, "userId")));
  });
}
