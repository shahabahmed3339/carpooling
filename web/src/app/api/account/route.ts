import { deleteOwnAccount } from "@/server/users/account";
import { readJsonObject, withActor } from "@/server/http/responses";

/**
 * Close the signed-in account. This is a destructive, non-idempotent-safe
 * action, so the caller must echo the confirmation phrase the UI shows.
 * A deleted account cannot sign in again, so a later retry fails closed with
 * ACCOUNT_NOT_ACTIVE rather than deleting anything else.
 */
export async function DELETE(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    if (body.confirm !== "DELETE") {
      return Response.json(
        { error: { code: "CONFIRMATION_REQUIRED", message: "Type DELETE to confirm closing your account." } },
        { status: 400 },
      );
    }
    return Response.json(await deleteOwnAccount({ actor }));
  });
}
