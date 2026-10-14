import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRecord, readFile, recentChanges, schemaCatalog, schemaText, searchRecords } from "@/lib/knowledge";
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
  const server = new McpServer(
    { name: "dimension-knowledge", version: "1.2.0" },
    {
      instructions:
        "Records describe locations, vendors, and other subjects. Some attributes hold files such as policies, handbooks, contracts, and certificates; " +
        "record cards list them as `name [file <id>]`. When a question depends on what a document says, call read_file with that id " +
        "(use find to jump to the relevant passages) and answer from the document's text, naming the file. search_records also matches text inside files.",
    },
  );
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
      description: "Find records by subject label, attribute display name, display value, or text inside attached files. Returns knowledge cards and record ids; files are listed as `name [file <id>]`, with the matching passage when the match was inside a file. Optional record type, dimension, and attribute narrow the match.",
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
      description: "Return one record as a knowledge card grouped by dimension, followed by the records that link to it. Only attributes this user can view are included. Attached files are listed as `name [file <id>]`; read them with read_file.",
      inputSchema: { id: z.string().describe("Record id.") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => text(await getRecord(access, id)),
  );
  server.registerTool(
    "read_file",
    {
      title: "Read a file",
      description:
        "Read the text of a file attached to a record (PDF, Word, Excel, PowerPoint, text, or CSV), such as a policy, handbook, or contract. " +
        "Use the id from a record card's `[file <id>]`. Use find to get the passages about a topic (for example \"notice period\" or \"final pay\"); " +
        "otherwise the text is returned in parts of 40,000 characters, and offset continues where the previous part ended.",
      inputSchema: {
        file_id: z.string().describe("The file id from a record card."),
        find: z.string().optional().describe("Words to look for. Returns the passages that mention them."),
        offset: z.number().int().min(0).optional().describe("Character position to read from. Defaults to the start."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ file_id, find, offset }) => text(await readFile(access, { fileId: file_id, find, offset })),
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
