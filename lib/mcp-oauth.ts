import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { assertAuthSecret } from "@/lib/session-token";

/**
 * OAuth for the hosted MCP endpoint. ChatGPT, Claude on the web, and Grok each have an
 * allow-list of redirect hosts. Anything else is refused, and each product stays off
 * until an administrator turns it on.
 */

export const AI_PRODUCTS = {
  CHATGPT: { label: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"] },
  CLAUDE: { label: "Claude", hosts: ["claude.ai"] },
  GROK: { label: "Grok", hosts: ["grok.com", "grok.x.ai"] },
} as const;

export type AiProduct = keyof typeof AI_PRODUCTS;

export type OauthSettings = { allowChatGpt: boolean; allowClaude: boolean; allowGrok: boolean };

export const OAUTH_OFF: OauthSettings = { allowChatGpt: false, allowClaude: false, allowGrok: false };

export const OAUTH_QUERY_COOKIE = "oauth_ai";
const QUERY_TTL_MS = 10 * 60_000;
const QUERY_MAX = 2000;

export type ConnectionFlags = {
  revokedAt: Date | null;
  allowRead: boolean;
  allowPropose: boolean;
  product: AiProduct;
};

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  state: string;
};

export type RedirectAssessment =
  | { ok: true; product: AiProduct; redirectUri: string }
  | { ok: false; reason: "invalid" | "foreign" | "disabled" };

const PRODUCT_ORDER = ["CHATGPT", "CLAUDE", "GROK"] as const;

export function productEnabled(settings: OauthSettings, product: AiProduct) {
  if (product === "CHATGPT") return settings.allowChatGpt;
  if (product === "CLAUDE") return settings.allowClaude;
  return settings.allowGrok;
}

export function enabledProductLabels(settings: OauthSettings) {
  return PRODUCT_ORDER.filter((product) => productEnabled(settings, product)).map((product) => AI_PRODUCTS[product].label);
}

/** Live view and propose for an OAuth connection. Null means the bearer token must be refused. */
export function connectionScopes(connection: ConnectionFlags, settings: OauthSettings, personCanPropose: boolean) {
  if (connection.revokedAt || !connection.allowRead || !productEnabled(settings, connection.product)) return null;
  return connection.allowPropose && personCanPropose ? ["read", "propose"] : ["read"];
}

export function publicOrigin(requestUrl: string) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return new URL(configured).origin;
  return new URL(requestUrl).origin;
}

export function originFromHeaders(headerList: { get(name: string): string | null }) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return new URL(configured).origin;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export function mcpResource(origin: string) {
  return new URL("/api/mcp", origin).toString();
}

export function resourceMatches(given: string, origin: string) {
  try {
    const url = new URL(given);
    const expected = new URL(mcpResource(origin));
    return url.origin === expected.origin && url.pathname.replace(/\/+$/, "") === expected.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: ["read", "propose"],
    bearer_methods_supported: ["header"],
    resource_name: "Dimension knowledge",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: new URL("/oauth/authorize", origin).toString(),
    token_endpoint: new URL("/oauth/token", origin).toString(),
    registration_endpoint: new URL("/oauth/register", origin).toString(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "propose"],
    client_id_metadata_document_supported: true,
  };
}

/** Sent on a 401 so an assistant can discover this authorization server. */
export function wwwAuthenticate(origin: string) {
  return `Bearer realm="dimension-knowledge", resource_metadata="${new URL("/.well-known/oauth-protected-resource", origin).toString()}"`;
}

export function productForHost(hostname: string): AiProduct | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const product of PRODUCT_ORDER) {
    if (AI_PRODUCTS[product].hosts.some((item) => host === item || host.endsWith(`.${item}`))) return product;
  }
  return null;
}

function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

/** A redirect is usable only when its host is one of the three assistants and that assistant is on. */
export function assessRedirect(value: string, settings: OauthSettings): RedirectAssessment {
  const url = httpsUrl(value);
  if (!url) return { ok: false, reason: "invalid" };
  const product = productForHost(url.hostname);
  if (!product) return { ok: false, reason: "foreign" };
  if (!productEnabled(settings, product)) return { ok: false, reason: "disabled" };
  return { ok: true, product, redirectUri: value };
}

export function parseAuthorizeQuery(params: URLSearchParams, origin: string): { ok: true } & AuthorizeRequest | { ok: false; reason: "invalid" } {
  const clientId = params.get("client_id")?.trim() ?? "";
  const redirectUri = params.get("redirect_uri")?.trim() ?? "";
  const codeChallenge = params.get("code_challenge")?.trim() ?? "";
  const state = params.get("state") ?? "";
  if (params.get("response_type") !== "code") return { ok: false, reason: "invalid" };
  if (!clientId || clientId.length > 500 || !httpsUrl(redirectUri)) return { ok: false, reason: "invalid" };
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return { ok: false, reason: "invalid" };
  if (!resourceMatches(params.get("resource")?.trim() ?? "", origin)) return { ok: false, reason: "invalid" };
  if (state.length > 512 || /[\r\n]/.test(state)) return { ok: false, reason: "invalid" };
  return { ok: true, clientId, redirectUri, codeChallenge, resource: mcpResource(origin), state };
}

export type RegistrationDraft = { name: string; redirectUris: string[]; product: AiProduct };

/** Dynamic registration accepts public clients whose redirect hosts all belong to one enabled assistant. */
export function parseRegistration(body: unknown, settings: OauthSettings): { ok: true } & RegistrationDraft | { ok: false; reason: "invalid" | "foreign" | "disabled" } {
  if (!body || typeof body !== "object") return { ok: false, reason: "invalid" };
  const record = body as Record<string, unknown>;
  const method = record.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return { ok: false, reason: "invalid" };
  const uris = record.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 8 || uris.some((item) => typeof item !== "string")) {
    return { ok: false, reason: "invalid" };
  }
  const assessed = uris.map((item) => assessRedirect(item, settings));
  const first = assessed[0];
  if (!first.ok) return first;
  for (const item of assessed) {
    if (!item.ok) return item;
    if (item.product !== first.product) return { ok: false, reason: "foreign" };
  }
  const name = typeof record.client_name === "string" && record.client_name.trim() ? record.client_name.trim().slice(0, 80) : AI_PRODUCTS[first.product].label;
  return { ok: true, name, redirectUris: assessed.map((item) => (item.ok ? item.redirectUri : "")), product: first.product };
}

export function pkceValid(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return false;
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const left = Buffer.from(actual);
  const right = Buffer.from(challenge);
  return left.length === right.length && timingSafeEqual(left, right);
}

function oauthKey() {
  assertAuthSecret();
  return Buffer.from(hkdfSync("sha256", process.env.AUTH_SECRET!.trim(), "dimension-ai-oauth", "authorize", 32));
}

/** The authorize query is sealed so login can return to this attempt and nothing else. */
export function sealOauthQuery(query: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ q: query, exp: now + QUERY_TTL_MS })).toString("base64url");
  const signature = createHmac("sha256", oauthKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function openOauthQuery(sealed: string | undefined, now = Date.now()) {
  if (!sealed) return null;
  const [body, signature] = sealed.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(createHmac("sha256", oauthKey()).update(body).digest("base64url"));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as { q?: unknown; exp?: unknown };
    const query = typeof payload.q === "string" ? payload.q : "";
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (!query || query.length > QUERY_MAX || /[\r\n]/.test(query) || query.includes("://") || !query.includes("response_type=code")) return null;
    return query;
  } catch {
    return null;
  }
}

/** Where password login and single sign-on continue, when this browser started an assistant sign-in. */
export function oauthResumePath(sealed: string | undefined) {
  const query = openOauthQuery(sealed);
  return query ? `/oauth/authorize?${query}` : null;
}

export function oauthMessage(reason: "invalid" | "foreign" | "disabled" | "unconfirmed" | "expired") {
  if (reason === "disabled") return "This assistant is turned off. An administrator can turn it on from AI access.";
  if (reason === "unconfirmed") return "This assistant could not be confirmed.";
  if (reason === "expired") return "This sign-in attempt expired. Start again from the assistant.";
  return "This assistant cannot connect.";
}

export const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

export function metadataDocument(clientId: string, document: unknown, settings: OauthSettings): { ok: true; name: string; redirectUris: string[]; product: AiProduct } | { ok: false; reason: "invalid" | "foreign" | "disabled" | "unconfirmed" } {
  const clientUrl = httpsUrl(clientId);
  const product = clientUrl ? productForHost(clientUrl.hostname) : null;
  if (!clientUrl || !product) return { ok: false, reason: "foreign" };
  if (!productEnabled(settings, product)) return { ok: false, reason: "disabled" };
  if (!document || typeof document !== "object") return { ok: false, reason: "unconfirmed" };
  const record = document as Record<string, unknown>;
  if (typeof record.client_id === "string" && record.client_id !== clientId) return { ok: false, reason: "unconfirmed" };
  if (record.token_endpoint_auth_method !== undefined && record.token_endpoint_auth_method !== "none") return { ok: false, reason: "unconfirmed" };
  const parsed = parseRegistration(
    { redirect_uris: record.redirect_uris, client_name: record.client_name, token_endpoint_auth_method: "none" },
    settings,
  );
  if (!parsed.ok) return parsed;
  if (parsed.product !== product) return { ok: false, reason: "foreign" };
  return parsed;
}
