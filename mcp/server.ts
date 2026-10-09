import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadKnowledgeUser } from "@/lib/knowledge";
import { createKnowledgeServer } from "@/lib/mcp-server";

/**
 * Local, read-only knowledge server over stdio. It answers as MCP_USER_EMAIL.
 * For per-person access and proposals, use the hosted endpoint at /api/mcp with an AI access token.
 */
async function main() {
  const email = process.env.MCP_USER_EMAIL?.trim() ?? "";
  if (!email) {
    console.error("Set MCP_USER_EMAIL to an active user. That user's view grants decide which facts are returned.");
    process.exit(1);
  }
  const access = await loadKnowledgeUser(email).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not load the knowledge user.");
    process.exit(1);
  });
  await createKnowledgeServer(access, { canPropose: false, tokenId: null }).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
