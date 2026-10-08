import { toNextJsHandler } from "better-auth/next-js";

async function handle(request: Request): Promise<Response> {
  if (process.env.AUTH_ENABLED !== "true") {
    return Response.json(
      { error: "AUTHENTICATION_DISABLED" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { auth } = await import("@/server/auth/config");
  const handlers = toNextJsHandler(auth);
  const response = await (request.method === "GET" ? handlers.GET(request) : handlers.POST(request));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET = handle;
export const POST = handle;
