import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getRecord,
  loadKnowledgeUser,
  recentChanges,
  schemaCatalog,
  schemaText,
  searchRecords,
} from "@/lib/knowledge";

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

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

  const server = new McpServer({ name: "dimension-knowledge", version: "1.0.0" });
  server.registerResource(
    "schema",
    "dimension://schema",
    {
      title: "Schema",
      description: "Active dimensions and attributes this user can view, including descriptions, types, choice lists, and which attribute a list follows.",
      mimeType: "text/plain",
    },
    async () => {
      const textBody = schemaText(await schemaCatalog(access));
      return { contents: [{ uri: "dimension://schema", mimeType: "text/plain", text: textBody }] };
    },
  );
  server.registerTool(
    "search_records",
    {
      title: "Search records",
      description: "Find records by subject label, attribute display name, or display value. Returns knowledge cards and record ids. Optional record type, dimension, and attribute narrow the match.",
      inputSchema: {
        query: z.string().describe("Text to match."),
        type: z.string().optional().describe("Record type name, such as Location or Vendor."),
        dimension: z.string().optional().describe("Dimension name."),
        attribute: z.string().optional().describe("Attribute key or display name."),
      },
    },
    async ({ query, type, dimension, attribute }) => text(await searchRecords(access, { query, type, dimension, attribute })),
  );
  server.registerTool(
    "get_record",
    {
      title: "Get record",
      description: "Return one record as a knowledge card grouped by dimension, followed by the records that link to it. Only attributes this user can view are included.",
      inputSchema: {
        id: z.string().describe("Record id."),
      },
    },
    async ({ id }) => text(await getRecord(access, id)),
  );
  server.registerTool(
    "recent_changes",
    {
      title: "Recent changes",
      description: "Changelog rows at or after a time: record id, subject, dimension, attribute, previous value, new value, person, and time.",
      inputSchema: {
        since: z.string().describe("ISO timestamp."),
      },
    },
    async ({ since }) => text(await recentChanges(access, since)),
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The knowledge server stopped.");
  process.exit(1);
});
