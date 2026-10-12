import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateToken } from "@/lib/access-tokens";
import { wwwAuthenticate, publicOrigin } from "@/lib/mcp-oauth";
import { canViewModule } from "@/lib/permissions";
import { createKnowledgeServer } from "@/lib/mcp-server";

/**
 * Hosted MCP endpoint (Streamable HTTP, stateless). Each request carries a personal AI access
 * token as "Authorization: Bearer edb_…". The assistant sees what that person can see, and can
 * propose changes only when the token has the "propose" scope and the person may edit records.
 */
function unauthorized(message: string, request: Request) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": wwwAuthenticate(publicOrigin(request.url)),
    },
  });
}

async function handle(request: Request) {
  const identity = await authenticateToken(request.headers.get("authorization"));
  if (!identity) return unauthorized("Send a valid AI access token as Authorization: Bearer. Create one on AI access.", request);
  if (!canViewModule(identity.access, "AI_ACCESS")) return unauthorized("This account is not allowed to use AI access.", request);
  const server = createKnowledgeServer(identity.access, {
    canPropose: identity.scopes.includes("propose"),
    tokenId: identity.tokenId,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET() {
  // Stateless server: no server-initiated stream.
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
