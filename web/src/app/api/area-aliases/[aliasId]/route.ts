import { deleteAreaAlias } from "@/server/commutes/areas";
import { requireUuid, withActor } from "@/server/http/responses";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ aliasId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { aliasId } = await context.params;
    await deleteAreaAlias({ actor, aliasId: requireUuid(aliasId, "aliasId") });
    return Response.json({ deleted: true });
  });
}
