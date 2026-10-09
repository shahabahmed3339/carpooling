import { getSupportSettings, updateSupportSettings } from "@/server/community/support";
import { readJsonObject, withActor } from "@/server/http/responses";

/**
 * Support contact shown in the app.
 *
 * GET is available to any active member — it is the point of the feature. PATCH
 * is restricted to operators/reviewers by the service layer.
 */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ support: await getSupportSettings(actor) }));
}

export async function PATCH(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    return Response.json({
      support: await updateSupportSettings({ actor, contact: body.contact, hours: body.hours }),
    });
  });
}
