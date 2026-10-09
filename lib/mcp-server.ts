import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRecord, recentChanges, schemaCatalog, schemaText, searchRecords } from "@/lib/knowledge";
import type { AccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createProposal } from "@/lib/proposals";

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], ...(isError ? { isError: true } : {}) };
}

/**
 * The knowledge server, for one person. Every tool answers within that person's grants.
 * With canPropose, the assistant can also submit changes, which wait for human review.
 */
export function createKnowledgeServer(access: AccessContext, options: { canPropose: boolean; tokenId: string | null }) {
  const server = new McpServer({ name: "dimension-knowledge", version: "1.1.0" });
  server.registerResource(
    "schema",
    "dimension://schema",
    {
      title: "Schema",
      description: "Record types, dimensions, and attributes this user can view, including descriptions, types, choice lists, links, and which attribute a list follows.",
      mimeType: "text/plain",
    },
    async () => ({ contents: [{ uri: "dimension://schema", mimeType: "text/plain", text: schemaText(await schemaCatalog(access)) }] }),
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
      annotations: { readOnlyHint: true },
    },
    async ({ query, type, dimension, attribute }) => text(await searchRecords(access, { query, type, dimension, attribute })),
  );
  server.registerTool(
    "get_record",
    {
      title: "Get record",
      description: "Return one record as a knowledge card grouped by dimension, followed by the records that link to it. Only attributes this user can view are included.",
      inputSchema: { id: z.string().describe("Record id.") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => text(await getRecord(access, id)),
  );
  server.registerTool(
    "recent_changes",
    {
      title: "Recent changes",
      description: "Changelog rows at or after a time: record id, subject, dimension, attribute, previous value, new value, person, and time.",
      inputSchema: { since: z.string().describe("ISO timestamp.") },
      annotations: { readOnlyHint: true },
    },
    async ({ since }) => text(await recentChanges(access, since)),
  );
  if (!options.canPropose) return server;

  server.registerTool(
    "propose_change",
    {
      title: "Propose a change",
      description:
        "Propose new values for a record, or a new record. Nothing is saved: a person reviews the proposal and approves or rejects it. " +
        "Values are checked with the same rules as the record form, and errors are returned right away. " +
        "Use attribute keys or display names from the schema; list choices and linked records can be given by their labels.",
      inputSchema: {
        record_id: z.string().optional().describe("The record to change. Leave out to propose a new record."),
        record_type: z.string().optional().describe("Record type name, required when proposing a new record."),
        changes: z.record(z.string(), z.string()).describe("Attribute key or display name mapped to the new value. An empty string clears a value."),
        reason: z.string().describe("Why the change is needed, and the source of the new values. Shown to the reviewer."),
      },
    },
    async ({ record_id, record_type, changes, reason }) => {
      const result = await createProposal({ access, tokenId: options.tokenId, recordId: record_id, recordType: record_type, values: changes, reason });
      return text(result.message, !result.ok);
    },
  );
  server.registerTool(
    "my_proposals",
    {
      title: "My proposals",
      description: "The latest proposals made with this account, with their status: pending, applied, rejected, or failed, and the reviewer's note.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const rows = await prisma.changeProposal.findMany({
        where: { proposedById: access.user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { reviewer: { select: { name: true } } },
      });
      if (!rows.length) return text("No proposals yet.");
      return text(
        rows
          .map((row) =>
            [row.id, row.status.toLowerCase(), row.createdAt.toISOString(), row.locationId ?? "new record", row.reviewer?.name ?? "", row.reviewNote || row.error]
              .filter(Boolean)
              .join(" | "),
          )
          .join("\n"),
      );
    },
  );
  return server;
}
