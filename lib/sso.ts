import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { requestOrigin } from "@/lib/public-origin";
import type { SsoSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertAuthSecret } from "@/lib/session-token";

/**
 * Single sign-on with any OpenID Connect provider: Microsoft Entra ID, Google Workspace,
 * Okta, Auth0, Keycloak, and others. The app uses the authorization code flow with PKCE,
 * state, and nonce, and validates the ID token with openid-client.
 */

const SETTINGS_ID = "default";
export const FLOW_COOKIE = "oidc_flow";
const FLOW_TTL_MS = 10 * 60_000;

export async function loadSsoSettings(): Promise<SsoSettings | null> {
  return prisma.ssoSettings.findUnique({ where: { id: SETTINGS_ID } });
}

/** What the sign-in page needs: whether to show the button, and its label. */
export async function ssoButton() {
  const settings = await loadSsoSettings().catch(() => null);
  return settings?.enabled && settings.issuer && settings.clientId ? { label: settings.buttonLabel || "Sign in with SSO" } : null;
}

/**
 * The address the provider sends people back to. APP_URL is preferred, because the request's
 * Host header can be changed by the caller. Register exactly this value with the provider.
 */
export function redirectUri(request: Request) {
  return new URL("/api/auth/oidc/callback", requestOrigin(request)).toString();
}

function flowKey() {
  assertAuthSecret();
  return Buffer.from(hkdfSync("sha256", process.env.AUTH_SECRET!.trim(), "dimension-sso", "oidc-flow", 32));
}

export type FlowState = { state: string; nonce: string; verifier: string; exp: number };

/** Signs the per-attempt values kept in a short-lived cookie between the redirect and the callback. */
export function sealFlow(flow: Omit<FlowState, "exp">, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...flow, exp: now + FLOW_TTL_MS })).toString("base64url");
  const signature = createHmac("sha256", flowKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function openFlow(sealed: string | undefined, now = Date.now()): FlowState | null {
  if (!sealed) return null;
  const [body, signature] = sealed.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(createHmac("sha256", flowKey()).update(body).digest("base64url"));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const flow = JSON.parse(Buffer.from(body, "base64url").toString()) as FlowState;
    return flow.exp > now && flow.state && flow.nonce && flow.verifier ? flow : null;
  } catch {
    return null;
  }
}

export type SsoClaims = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  preferred_username?: unknown;
  name?: unknown;
};

type KnownUser = { id: string; isActive: boolean; oidcSubject: string | null };

/** Messages the sign-in page shows, by code. Only these codes are ever displayed. */
export const SSO_MESSAGES = {
  "not-setup": "Single sign-on is not set up.",
  secret: "The single sign-on client secret could not be read. An administrator must enter it again.",
  unreachable: "The identity provider could not be reached.",
  expired: "The sign-in attempt expired. Try again.",
  rejected: "The identity provider did not confirm the sign-in.",
  "no-subject": "The provider did not identify the account.",
  disabled: "This account is disabled.",
  "no-email": "The provider did not share a verified email address.",
  domain: "This email domain is not allowed to sign in.",
  "other-identity": "This email is linked to a different single sign-on identity.",
  "no-account": "There is no account for this email. Ask an administrator to add you.",
} as const;

export type SsoReason = keyof typeof SSO_MESSAGES;

export type SsoDecision =
  | { kind: "signin"; userId: string }
  | { kind: "link"; userId: string }
  | { kind: "create"; email: string; name: string }
  | { kind: "deny"; reason: SsoReason };

/** The email the provider vouches for, or null. */
export function claimedEmail(claims: SsoClaims) {
  if (claims.email_verified === false || claims.email_verified === "false") return null;
  const email = typeof claims.email === "string" && claims.email.includes("@") ? claims.email : null;
  // Microsoft Entra ID often sends the sign-in name instead of email. It is controlled by the
  // tenant, and the configured issuer is tenant-specific, so it is accepted when email is absent.
  const fallback = typeof claims.preferred_username === "string" && claims.preferred_username.includes("@") ? claims.preferred_username : null;
  return (email ?? fallback)?.trim().toLowerCase() ?? null;
}

export function domainAllowed(email: string, allowed: string[]) {
  const domains = allowed.map((domain) => domain.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (!domains.length) return true;
  const domain = email.split("@").pop() ?? "";
  return domains.includes(domain);
}

/**
 * Decides what a successful provider sign-in means here. The provider's subject is the
 * durable link: once an account is linked, a different subject with the same email is refused.
 */
export function decideSso(
  claims: SsoClaims,
  settings: Pick<SsoSettings, "allowedDomains" | "createUsers">,
  bySubject: KnownUser | null,
  byEmail: KnownUser | null,
): SsoDecision {
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject) return { kind: "deny", reason: "no-subject" };
  if (bySubject) return bySubject.isActive ? { kind: "signin", userId: bySubject.id } : { kind: "deny", reason: "disabled" };
  const email = claimedEmail(claims);
  if (!email) return { kind: "deny", reason: "no-email" };
  if (!domainAllowed(email, settings.allowedDomains)) return { kind: "deny", reason: "domain" };
  if (byEmail) {
    if (!byEmail.isActive) return { kind: "deny", reason: "disabled" };
    if (byEmail.oidcSubject && byEmail.oidcSubject !== subject) {
      return { kind: "deny", reason: "other-identity" };
    }
    return { kind: "link", userId: byEmail.id };
  }
  if (!settings.createUsers) return { kind: "deny", reason: "no-account" };
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 120) : email.split("@")[0];
  return { kind: "create", email, name };
}

type DiscoveredConfig = Awaited<ReturnType<typeof import("openid-client").discovery>>;
const configCache = new Map<string, { at: number; config: DiscoveredConfig }>();

/** Discovers the provider's endpoints and keys, cached for an hour per configuration. */
export async function providerConfig(settings: Pick<SsoSettings, "issuer" | "clientId">, clientSecret: string) {
  const client = await import("openid-client");
  const cacheKey = `${settings.issuer}|${settings.clientId}|${createHmac("sha256", "cache").update(clientSecret).digest("hex")}`;
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60 * 60_000) return { client, config: cached.config };
  const issuer = new URL(settings.issuer);
  // Plain http is allowed only for a provider on this machine, such as a local Keycloak.
  const local = issuer.protocol === "http:" && ["localhost", "127.0.0.1"].includes(issuer.hostname);
  const config = await client.discovery(
    issuer,
    settings.clientId,
    undefined,
    client.ClientSecretBasic(clientSecret),
    local ? { execute: [client.allowInsecureRequests] } : undefined,
  );
  configCache.set(cacheKey, { at: Date.now(), config });
  return { client, config };
}
