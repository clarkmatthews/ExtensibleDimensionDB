import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/knowledge", () => ({
  schemaCatalog: async () => [],
  schemaText: () => "Record type: Location",
  searchRecords: async () => "Record: r1\nType: Location\nSubject: Mesa Verde Grill",
  getRecord: async () => "card",
  recentChanges: async () => "none",
}));
const proposals = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/proposals", () => ({
  createProposal: async (input: unknown) => {
    proposals.calls.push(input);
    return { ok: true, message: "Submitted proposal p1 for review." };
  },
}));

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createKnowledgeServer } from "@/lib/mcp-server";
import type { AccessContext } from "@/lib/permissions";

const access = { user: { id: "u1", isAdmin: false, name: "Pat" } } as unknown as AccessContext;

/** Sends one JSON-RPC message the way the hosted endpoint handles it: a fresh stateless server per request. */
async function call(canPropose: boolean, message: object) {
  const server = createKnowledgeServer(access, { canPropose, tokenId: "t1" });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
    }),
  );
  await server.close();
  return { status: response.status, body: await response.json() };
}

describe("hosted MCP endpoint", () => {
  it("answers initialize in stateless JSON mode", async () => {
    const { status, body } = await call(false, {
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("dimension-knowledge");
  });

  it("offers only read tools to a read-only token", async () => {
    const { body } = await call(false, { method: "tools/list", params: {} });
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["search_records", "get_record", "recent_changes"]));
    expect(names).not.toContain("propose_change");
  });

  it("adds propose_change for a token with the propose scope, and passes the person's access through", async () => {
    const { body } = await call(true, { method: "tools/list", params: {} });
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(["propose_change", "my_proposals"]));
    const result = await call(true, {
      method: "tools/call",
      params: { name: "propose_change", arguments: { record_id: "r1", changes: { phone: "480-555-0100" }, reason: "Website lists a new number." } },
    });
    expect(result.body.result.content[0].text).toMatch(/Submitted proposal/);
    expect(proposals.calls[0]).toMatchObject({ access, tokenId: "t1", recordId: "r1", values: { phone: "480-555-0100" } });
  });

  it("runs search with the arguments the model sent", async () => {
    const result = await call(false, { method: "tools/call", params: { name: "search_records", arguments: { query: "Mesa", type: "Location" } } });
    expect(result.body.result.content[0].text).toContain("Mesa Verde Grill");
  });
});

describe("proposal review rules", async () => {
  const { reviewBlocker } = await vi.importActual<typeof import("@/lib/proposals")>("@/lib/proposals");
  const reviewer = (id: string, isAdmin: boolean, edit: boolean) =>
    ({
      user: { id, isAdmin },
      groupIds: [],
      categoryPerms: [],
      fieldPerms: [],
      modulePerms: edit ? [{ module: "PROPOSALS", subjectType: "USER", subjectId: id, grantLevel: "EDIT" }] : [],
    }) as unknown as AccessContext;

  it("needs edit access to proposals", () => {
    expect(reviewBlocker(reviewer("r", false, false), { proposedById: "p", status: "PENDING" })).toMatch(/cannot review/);
    expect(reviewBlocker(reviewer("r", false, true), { proposedById: "p", status: "PENDING" })).toBeNull();
  });

  it("does not let people approve their own proposals, unless they are administrators", () => {
    expect(reviewBlocker(reviewer("p", false, true), { proposedById: "p", status: "PENDING" })).toMatch(/Someone else/);
    expect(reviewBlocker(reviewer("p", true, false), { proposedById: "p", status: "PENDING" })).toBeNull();
  });

  it("does not review a proposal twice", () => {
    expect(reviewBlocker(reviewer("r", true, true), { proposedById: "p", status: "APPLIED" })).toMatch(/already/);
  });
});
