import { randomBytes } from "node:crypto";
import { hashToken, newToken } from "@/lib/access-tokens";
import {
  assessRedirect,
  metadataDocument,
  OAUTH_OFF,
  parseRegistration,
  pkceValid,
  productEnabled,
  resourceMatches,
  type AiProduct,
  type AuthorizeRequest,
} from "@/lib/mcp-oauth";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const CODE_TTL_MS = 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const METADATA_MAX = 65_536;

export async function loadOauthSettings() {
  const row = await prisma.aiOauthSettings.findUnique({ where: { id: "default" } });
  return row ?? OAUTH_OFF;
}

async function readMetadata(clientId: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(clientId, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length > METADATA_MAX) return null;
  return JSON.parse(text) as unknown;
}

/**
 * Confirms the assistant is one of the three, and that this redirect is listed for it.
 * A client id that is an https URL is a metadata document. Any other id was registered here.
 * Metadata is fetched only from an assistant host, and redirects are not followed.
 */
export async function resolveOauthClient(request: AuthorizeRequest, fetchImpl: typeof fetch = fetch) {
  const settings = await loadOauthSettings();
  const redirect = assessRedirect(request.redirectUri, settings);
  if (!redirect.ok) return redirect;

  if (request.clientId.startsWith("https://")) {
    let document: unknown = null;
    try {
      document = await readMetadata(request.clientId, fetchImpl);
    } catch {
      return { ok: false as const, reason: "unconfirmed" as const };
    }
    const meta = metadataDocument(request.clientId, document, settings);
    if (!meta.ok) return meta;
    if (!meta.redirectUris.includes(request.redirectUri)) return { ok: false as const, reason: "foreign" as const };
    const client = await prisma.oauthClient.upsert({
      where: { clientId: request.clientId },
      create: { clientId: request.clientId, name: meta.name, redirectUris: meta.redirectUris, product: meta.product },
      update: { name: meta.name, redirectUris: meta.redirectUris, product: meta.product },
    });
    return { ok: true as const, client, product: meta.product as AiProduct };
  }

  const client = await prisma.oauthClient.findUnique({ where: { clientId: request.clientId } });
  if (!client || client.product !== redirect.product || !client.redirectUris.includes(request.redirectUri)) {
    return { ok: false as const, reason: "foreign" as const };
  }
  if (!productEnabled(settings, client.product)) return { ok: false as const, reason: "disabled" as const };
  return { ok: true as const, client, product: client.product };
}

export async function registerOauthClient(body: unknown) {
  const settings = await loadOauthSettings();
  const parsed = parseRegistration(body, settings);
  if (!parsed.ok) return parsed;
  const client = await prisma.oauthClient.create({
    data: {
      clientId: `edb_client_${randomBytes(24).toString("base64url")}`,
      name: parsed.name,
      redirectUris: parsed.redirectUris,
      product: parsed.product,
    },
  });
  return {
    ok: true as const,
    product: parsed.product,
    body: {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

export async function issueAuthorizationCode(input: {
  userId: string;
  oauthClientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  allowRead: boolean;
  allowPropose: boolean;
}) {
  const code = `edb_code_${randomBytes(32).toString("base64url")}`;
  await prisma.oauthCode.create({
    data: {
      codeHash: hashToken(code),
      oauthClientId: input.oauthClientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      allowRead: input.allowRead,
      allowPropose: input.allowPropose,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

function tokenBody(accessToken: string, refreshToken: string, allowPropose: boolean) {
  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refreshToken,
    scope: allowPropose ? "read propose" : "read",
  };
}

async function issueAccessToken(input: { userId: string; connectionId: string; name: string; allowPropose: boolean }) {
  const accessToken = newToken();
  const refreshToken = `edb_rt_${randomBytes(32).toString("base64url")}`;
  await prisma.accessToken.create({
    data: {
      userId: input.userId,
      connectionId: input.connectionId,
      name: input.name,
      tokenHash: accessToken.hash,
      prefix: accessToken.prefix,
      scopes: input.allowPropose ? ["read", "propose"] : ["read"],
      expiresAt: new Date(Date.now() + ACCESS_TTL_MS),
    },
  });
  await prisma.oauthRefreshToken.create({
    data: {
      connectionId: input.connectionId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return tokenBody(accessToken.token, refreshToken, input.allowPropose);
}

/** Exchanges a code once. A wrong PKCE verifier leaves the code unused. */
export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string | null;
  origin: string;
}) {
  const codeHash = hashToken(input.code);
  const row = await prisma.oauthCode.findUnique({
    where: { codeHash },
    include: { client: true, user: { include: { groups: { include: { group: true } } } } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return { ok: false as const, error: "invalid_grant" };
  if (row.client.clientId !== input.clientId || row.redirectUri !== input.redirectUri) return { ok: false as const, error: "invalid_grant" };
  if (input.resource && !resourceMatches(input.resource, input.origin)) return { ok: false as const, error: "invalid_target" };
  if (!pkceValid(input.codeVerifier, row.codeChallenge)) return { ok: false as const, error: "invalid_grant" };
  const settings = await loadOauthSettings();
  if (!productEnabled(settings, row.client.product) || !row.user.isActive || !row.allowRead) return { ok: false as const, error: "invalid_grant" };
  const access = await loadAccess(row.user);
  if (!canViewModule(access, "AI_ACCESS")) return { ok: false as const, error: "invalid_grant" };
  const allowPropose = row.allowPropose && canEditModule(access, "AI_ACCESS") && canEditModule(access, "STORES");

  const claimed = await prisma.oauthCode.updateMany({
    where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false as const, error: "invalid_grant" };

  const connection = await prisma.oauthConnection.create({
    data: {
      userId: row.userId,
      oauthClientId: row.oauthClientId,
      product: row.client.product,
      name: row.client.name,
      allowRead: true,
      allowPropose,
    },
  });
  return { ok: true as const, token: await issueAccessToken({ userId: row.userId, connectionId: connection.id, name: row.client.name, allowPropose }) };
}

/** Rotates a refresh token. View and propose are read from the connection, so a switch applies on the next token. */
export async function exchangeRefreshToken(input: { refreshToken: string; clientId: string; resource: string | null; origin: string }) {
  const tokenHash = hashToken(input.refreshToken);
  const row = await prisma.oauthRefreshToken.findUnique({
    where: { tokenHash },
    include: { connection: { include: { client: true, user: { include: { groups: { include: { group: true } } } } } } },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return { ok: false as const, error: "invalid_grant" };
  const connection = row.connection;
  if (connection.revokedAt || !connection.allowRead || connection.client.clientId !== input.clientId) return { ok: false as const, error: "invalid_grant" };
  if (input.resource && !resourceMatches(input.resource, input.origin)) return { ok: false as const, error: "invalid_target" };
  const settings = await loadOauthSettings();
  if (!productEnabled(settings, connection.product) || !connection.user.isActive) return { ok: false as const, error: "invalid_grant" };
  const access = await loadAccess(connection.user);
  if (!canViewModule(access, "AI_ACCESS")) return { ok: false as const, error: "invalid_grant" };
  const allowPropose = connection.allowPropose && canEditModule(access, "AI_ACCESS") && canEditModule(access, "STORES");

  const claimed = await prisma.oauthRefreshToken.updateMany({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false as const, error: "invalid_grant" };
  return { ok: true as const, token: await issueAccessToken({ userId: connection.userId, connectionId: connection.id, name: connection.name, allowPropose }) };
}
