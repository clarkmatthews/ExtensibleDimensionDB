import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { decryptSecret } from "@/lib/mail";
import { oauthResumePath, OAUTH_QUERY_COOKIE } from "@/lib/mcp-oauth";
import { prisma } from "@/lib/prisma";
import { setSession } from "@/lib/session";
import { decideSso, FLOW_COOKIE, loadSsoSettings, openFlow, providerConfig, redirectUri, type SsoClaims, type SsoReason } from "@/lib/sso";

function fail(request: NextRequest, reason: SsoReason) {
  const response = NextResponse.redirect(new URL(`/login?error=sso&reason=${encodeURIComponent(reason)}`, request.url));
  response.cookies.delete({ name: FLOW_COOKIE, path: "/api/auth/oidc" });
  return response;
}

/** Finishes single sign-on: checks state, nonce, and PKCE, validates the ID token, then signs the person in. */
export async function GET(request: NextRequest) {
  const settings = await loadSsoSettings();
  if (!settings?.enabled) return fail(request, "not-setup");
  const flow = openFlow(request.cookies.get(FLOW_COOKIE)?.value);
  if (!flow) return fail(request, "expired");

  let claims: SsoClaims;
  try {
    const { client, config } = await providerConfig(settings, decryptSecret(settings.clientSecret));
    // Rebuild the callback URL on the registered redirect URI, so the code exchange uses exactly that address.
    const callback = new URL(redirectUri(request.url));
    callback.search = request.nextUrl.search;
    const tokens = await client.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    claims = (tokens.claims() ?? {}) as SsoClaims;
  } catch (error) {
    console.error("Single sign-on failed", error);
    return fail(request, "rejected");
  }

  const subject = typeof claims.sub === "string" ? claims.sub : "";
  const emailClaim = typeof claims.email === "string" ? claims.email : typeof claims.preferred_username === "string" ? claims.preferred_username : "";
  const [bySubject, byEmail] = await Promise.all([
    subject ? prisma.user.findUnique({ where: { oidcSubject: subject } }) : Promise.resolve(null),
    emailClaim ? prisma.user.findFirst({ where: { email: { equals: emailClaim.trim(), mode: "insensitive" } } }) : Promise.resolve(null),
  ]);
  const decision = decideSso(claims, settings, bySubject, byEmail);
  if (decision.kind === "deny") return fail(request, decision.reason);

  let userId: string;
  if (decision.kind === "create") {
    // The account can only sign in through the provider until someone sets a password.
    const created = await prisma.user.create({
      data: {
        email: decision.email,
        name: decision.name,
        oidcSubject: subject,
        passwordHash: await hash(randomBytes(32).toString("base64url"), 10),
      },
    });
    if (settings.defaultGroupId) {
      const group = await prisma.group.findFirst({ where: { id: settings.defaultGroupId, isActive: true } });
      if (group) await prisma.userGroup.create({ data: { userId: created.id, groupId: group.id } });
    }
    await writeAudit("session.ssoCreateUser", { email: decision.email }, created.id);
    userId = created.id;
  } else {
    if (decision.kind === "link") await prisma.user.update({ where: { id: decision.userId }, data: { oidcSubject: subject } });
    userId = decision.userId;
  }

  await setSession(userId);
  await writeAudit("session.ssoSignIn", { provider: settings.issuer }, userId);
  const resume = oauthResumePath(request.cookies.get(OAUTH_QUERY_COOKIE)?.value);
  const response = NextResponse.redirect(new URL(resume ?? "/dashboard", request.url));
  response.cookies.delete({ name: FLOW_COOKIE, path: "/api/auth/oidc" });
  return response;
}
