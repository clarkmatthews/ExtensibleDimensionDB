import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const prismaMock = vi.hoisted(() => ({
  accessToken: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  aiOauthSettings: { findUnique: vi.fn() },
  oauthCode: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  oauthConnection: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  oauthRefreshToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/permissions", () => ({
  loadAccess: async (user: { id: string }) => ({ user }),
  canViewModule: () => true,
  canEditModule: () => true,
}));
vi.mock("@/lib/knowledge", () => ({
  schemaCatalog: async () => [],
  schemaText: () => "",
  searchRecords: async () => "",
  getRecord: async () => "",
  recentChanges: async () => "",
}));
vi.mock("@/lib/proposals", () => ({ createProposal: async () => ({ ok: true, message: "ok" }) }));

import { authenticateToken } from "@/lib/access-tokens";
import { cleanUpOauth, exchangeAuthorizationCode, exchangeRefreshToken } from "@/lib/mcp-oauth-flow";
import { createKnowledgeServer } from "@/lib/mcp-server";
import type { AccessContext } from "@/lib/permissions";
import {
  accessChoice,
  accessLabel,
  assessRedirect,
  authorizationServerMetadata,
  connectionScopes,
  oauthResumePath,
  openOauthQuery,
  parseRegistration,
  pkceValid,
  protectedResourceMetadata,
  sealOauthQuery,
  wwwAuthenticate,
} from "@/lib/mcp-oauth";

const chatgptOn = { allowChatGpt: true, allowClaude: false, allowGrok: false };

async function toolNames(canPropose: boolean) {
  const server = createKnowledgeServer({ user: { id: "u1" } } as AccessContext, { canPropose, tokenId: "t1" });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  await server.close();
  const body = await response.json();
  return body.result.tools.map((tool: { name: string }) => tool.name) as string[];
}

describe("MCP OAuth metadata and clients", () => {
  it("publishes the resource and authorization server, and the 401 challenge points at the resource", () => {
    expect(protectedResourceMetadata("https://db.example").resource).toBe("https://db.example/api/mcp");
    expect(authorizationServerMetadata("https://db.example")).toMatchObject({
      authorization_endpoint: "https://db.example/oauth/authorize",
      token_endpoint: "https://db.example/oauth/token",
      registration_endpoint: "https://db.example/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
    expect(wwwAuthenticate("https://db.example")).toBe(
      'Bearer realm="dimension-knowledge", resource_metadata="https://db.example/.well-known/oauth-protected-resource"',
    );
  });

  it("refuses a foreign redirect host and a disabled product", () => {
    expect(assessRedirect("https://chatgpt.com/callback", chatgptOn)).toMatchObject({ ok: true, product: "CHATGPT" });
    expect(assessRedirect("https://evil.example/callback", chatgptOn)).toMatchObject({ reason: "foreign" });
    expect(assessRedirect("https://claude.ai/callback", chatgptOn)).toMatchObject({ reason: "disabled" });
    expect(parseRegistration({ redirect_uris: ["https://evil.example/cb"], token_endpoint_auth_method: "none" }, chatgptOn)).toMatchObject({ reason: "foreign" });
    expect(parseRegistration({ redirect_uris: ["https://claude.ai/cb"], token_endpoint_auth_method: "none" }, chatgptOn)).toMatchObject({ reason: "disabled" });
  });

  it("checks PKCE S256 and only resumes a sealed authorize query", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(pkceValid(verifier, challenge)).toBe(true);
    const flipped = challenge.slice(0, -1) + (challenge.endsWith("a") ? "b" : "a");
    expect(pkceValid(verifier, flipped)).toBe(false);
    const sealed = sealOauthQuery("response_type=code&client_id=abc");
    expect(oauthResumePath(sealed)).toBe("/oauth/authorize?response_type=code&client_id=abc");
    expect(openOauthQuery(`${sealed}x`)).toBeNull();
  });
});

describe("OAuth tokens follow the connection switches", () => {
  beforeEach(() => {
    for (const model of Object.values(prismaMock)) {
      for (const fn of Object.values(model)) fn.mockReset();
    }
  });

  it("hides propose after the switch without issuing a new token, and stops when the product is off", async () => {
    const connection = { revokedAt: null, allowRead: true, allowPropose: true, product: "CHATGPT" as const };
    const row = {
      id: "t1",
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: new Date(),
      scopes: ["read"],
      user: { id: "u1", isActive: true, name: "Pat", groups: [] },
      connectionId: "c1",
      connection,
    };
    prismaMock.accessToken.findUnique.mockResolvedValue(row);
    prismaMock.aiOauthSettings.findUnique.mockResolvedValue({ allowChatGpt: true, allowClaude: false, allowGrok: false });

    const first = await authenticateToken("Bearer edb_same_token");
    expect(first?.tokenId).toBe("t1");
    expect(first?.scopes).toEqual(["read", "propose"]);
    expect(await toolNames(first?.scopes.includes("propose") ?? false)).toContain("propose_change");

    connection.allowPropose = false;
    const second = await authenticateToken("Bearer edb_same_token");
    expect(second?.tokenId).toBe("t1");
    expect(second?.scopes).toEqual(["read"]);
    expect(await toolNames(false)).not.toContain("propose_change");
    expect(connectionScopes(connection, chatgptOn, true)).toEqual(["read"]);

    prismaMock.aiOauthSettings.findUnique.mockResolvedValue({ allowChatGpt: false, allowClaude: false, allowGrok: false });
    expect(await authenticateToken("Bearer edb_same_token")).toBeNull();
  });

  it("leaves a pasted token on the scopes it was created with", async () => {
    prismaMock.accessToken.findUnique.mockResolvedValue({
      id: "pasted",
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: new Date(),
      scopes: ["read"],
      user: { id: "u1", isActive: true, name: "Pat", groups: [] },
      connectionId: null,
      connection: null,
    });
    expect((await authenticateToken("Bearer edb_pastedtoken"))?.scopes).toEqual(["read"]);
  });

  it("does not consume a code when PKCE fails, and consumes it only once", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    let used = false;
    prismaMock.oauthCode.findUnique.mockImplementation(async () => ({
      usedAt: used ? new Date() : null,
      expiresAt: new Date(Date.now() + 60_000),
      redirectUri: "https://chatgpt.com/callback",
      codeChallenge: challenge,
      allowRead: true,
      allowPropose: false,
      userId: "u1",
      oauthClientId: "oc1",
      client: { clientId: "edb_client_test", product: "CHATGPT", name: "ChatGPT" },
      user: { id: "u1", isActive: true, name: "Pat", groups: [] },
    }));
    prismaMock.oauthCode.updateMany.mockImplementation(async () => {
      if (used) return { count: 0 };
      used = true;
      return { count: 1 };
    });
    prismaMock.aiOauthSettings.findUnique.mockResolvedValue(chatgptOn);
    prismaMock.oauthConnection.create.mockResolvedValue({ id: "conn1" });
    prismaMock.oauthConnection.findMany.mockResolvedValue([]);
    prismaMock.accessToken.create.mockResolvedValue({});
    prismaMock.oauthRefreshToken.create.mockResolvedValue({});

    const input = {
      code: "edb_code_test",
      clientId: "edb_client_test",
      redirectUri: "https://chatgpt.com/callback",
      resource: null,
      origin: "https://db.example",
    };
    const rejected = await exchangeAuthorizationCode({ ...input, codeVerifier: "a".repeat(50) });
    expect(rejected).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(used).toBe(false);

    const issued = await exchangeAuthorizationCode({ ...input, codeVerifier: verifier });
    expect(issued.ok).toBe(true);
    if (issued.ok) expect(issued.token.access_token.startsWith("edb_")).toBe(true);
    const replay = await exchangeAuthorizationCode({ ...input, codeVerifier: verifier });
    expect(replay).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("replaces the person's earlier connection to the same assistant", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    prismaMock.oauthCode.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: challenge,
      allowRead: true,
      allowPropose: false,
      userId: "u1",
      oauthClientId: "oc2",
      client: { clientId: "edb_client_new", product: "CLAUDE", name: "Claude" },
      user: { id: "u1", isActive: true, name: "Pat", groups: [] },
    });
    prismaMock.oauthCode.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiOauthSettings.findUnique.mockResolvedValue({ allowChatGpt: false, allowClaude: true, allowGrok: false });
    prismaMock.oauthConnection.create.mockResolvedValue({ id: "new" });
    prismaMock.oauthConnection.findMany.mockResolvedValue([{ id: "old" }]);
    prismaMock.oauthConnection.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.accessToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.oauthRefreshToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await exchangeAuthorizationCode({
      code: "edb_code_again",
      clientId: "edb_client_new",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeVerifier: verifier,
      resource: null,
      origin: "https://db.example",
    });
    expect(result).toMatchObject({ ok: true, replaced: 1 });
    expect(prismaMock.oauthConnection.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", product: "CLAUDE", revokedAt: null, id: { not: "new" } },
      select: { id: true },
    });
    const ended = prismaMock.oauthConnection.updateMany.mock.calls[0][0];
    expect(ended.where.id).toEqual({ in: ["old"] });
    expect(prismaMock.accessToken.updateMany.mock.calls[0][0].where.connectionId).toEqual({ in: ["old"] });
    expect(prismaMock.oauthRefreshToken.updateMany.mock.calls[0][0].where.connectionId).toEqual({ in: ["old"] });
  });
});

describe("Refresh token reuse", () => {
  beforeEach(() => {
    for (const model of Object.values(prismaMock)) {
      for (const fn of Object.values(model)) fn.mockReset();
    }
    prismaMock.oauthConnection.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.accessToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.oauthRefreshToken.updateMany.mockResolvedValue({ count: 1 });
  });

  const input = { refreshToken: "edb_rt_old", clientId: "edb_client_test", resource: null, origin: "https://db.example" };
  function rotated(secondsAgo: number) {
    return {
      revokedAt: new Date(Date.now() - secondsAgo * 1000),
      expiresAt: new Date(Date.now() + 86_400_000),
      connectionId: "c1",
      connection: { revokedAt: null, userId: "u1", allowRead: true, client: { clientId: "edb_client_test" } },
    };
  }

  it("ends the whole connection when a rotated refresh token comes back later", async () => {
    prismaMock.oauthRefreshToken.findUnique.mockResolvedValue(rotated(300));
    const result = await exchangeRefreshToken(input);
    expect(result).toMatchObject({ ok: false, error: "invalid_grant", reused: true, connectionId: "c1" });
    expect(prismaMock.oauthConnection.updateMany.mock.calls[0][0].where.id).toEqual({ in: ["c1"] });
  });

  it("treats a quick retry as a retry, and leaves the connection alone", async () => {
    prismaMock.oauthRefreshToken.findUnique.mockResolvedValue(rotated(5));
    const result = await exchangeRefreshToken(input);
    expect(result).toMatchObject({ ok: false, error: "invalid_grant", reused: false });
    expect(prismaMock.oauthConnection.updateMany).not.toHaveBeenCalled();
  });
});

describe("Access choice and clean-up", () => {
  it("reads one access choice, defaulting to view only", () => {
    expect(accessChoice("propose")).toBe("propose");
    expect(accessChoice("on")).toBe("view");
    expect(accessChoice(null)).toBe("view");
    expect(accessLabel(true)).toBe("View and propose");
    expect(accessLabel(false)).toBe("View only");
  });

  it("keeps assistant tokens that a proposal points at, and rotated refresh tokens until they expire", async () => {
    prismaMock.accessToken.deleteMany.mockResolvedValue({ count: 3 });
    prismaMock.oauthCode.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.oauthRefreshToken.deleteMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-10-12T12:00:00Z");
    expect(await cleanUpOauth(now)).toEqual({ tokens: 3, codes: 2, refreshTokens: 1 });
    const tokens = prismaMock.accessToken.deleteMany.mock.calls.at(-1)?.[0];
    expect(tokens.where.connectionId).toEqual({ not: null });
    expect(tokens.where.proposals).toEqual({ none: {} });
    const refresh = prismaMock.oauthRefreshToken.deleteMany.mock.calls.at(-1)?.[0];
    expect(refresh.where.OR[0]).toEqual({ expiresAt: { lt: now } });
  });
});
