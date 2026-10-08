import { updateParticipantMode } from "@/server/users/profile";
import { HttpInputError, readJsonObject, requiredString, withActor } from "@/server/http/responses";

export async function PATCH(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    const mode = requiredString(body.mode, "mode");
    if (mode !== "RIDER" && mode !== "DRIVER") throw new HttpInputError("Choose Rider or Driver.");
    return Response.json(await updateParticipantMode({ actor, mode }));
  });
}
