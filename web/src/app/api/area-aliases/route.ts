import { createAreaAlias, listAreaAliases } from "@/server/commutes/areas";
import { HttpInputError, optionalString, readJsonObject, requiredString, withActor } from "@/server/http/responses";

/**
 * Area aliases are readable by any active member (they explain why a search
 * matched), but only reviewer/operator accounts may change them.
 */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => Response.json({ aliases: await listAreaAliases(actor) }));
}

export async function POST(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    const aliasArea = requiredString(body.aliasArea, "aliasArea");
    const canonicalArea = requiredString(body.canonicalArea, "canonicalArea");
    if (aliasArea.length > 120 || canonicalArea.length > 120) {
      throw new HttpInputError("Area names must be 120 characters or fewer.");
    }
    const created = await createAreaAlias({
      actor,
      aliasArea,
      canonicalArea,
      note: optionalString(body.note),
    });
    return Response.json({ alias: created }, { status: 201 });
  });
}
