import { deleteAreaCoordinate } from "@/server/commutes/areas";
import { requireUuid, withActor } from "@/server/http/responses";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ coordinateId: string }> },
): Promise<Response> {
  return withActor(async (actor) => {
    const { coordinateId } = await context.params;
    await deleteAreaCoordinate({ actor, coordinateId: requireUuid(coordinateId, "coordinateId") });
    return Response.json({ deleted: true });
  });
}
