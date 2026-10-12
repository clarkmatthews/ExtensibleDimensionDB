import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { issueAuthorizationCode, resolveOauthClient } from "@/lib/mcp-oauth-flow";
import { OAUTH_QUERY_COOKIE, openOauthQuery, parseAuthorizeQuery, publicOrigin } from "@/lib/mcp-oauth";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

function clearCookie(response: NextResponse, request: NextRequest) {
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  response.cookies.set(OAUTH_QUERY_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || https,
    path: "/",
    maxAge: 0,
  });
  return response;
}

/** Approves or cancels the assistant sign-in sealed in the cookie. The redirect comes from that request, not the form. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const origin = publicOrigin(request.url);
  const query = openOauthQuery(request.cookies.get(OAUTH_QUERY_COOKIE)?.value);
  const parsed = query ? parseAuthorizeQuery(new URLSearchParams(query), origin) : null;
  if (!parsed?.ok) return NextResponse.redirect(new URL("/oauth/consent", request.url));
  const client = await resolveOauthClient(parsed);
  if (!client.ok) return NextResponse.redirect(new URL("/oauth/consent", request.url));

  const form = await request.formData();
  const access = await loadAccess(user);
  const canPropose = canEditModule(access, "AI_ACCESS") && canEditModule(access, "STORES");
  const approve = form.get("decision") === "approve" && form.get("read") === "on" && canViewModule(access, "AI_ACCESS");
  const target = new URL(parsed.redirectUri);
  if (parsed.state) target.searchParams.set("state", parsed.state);

  if (!approve) {
    target.searchParams.set("error", "access_denied");
    await writeAudit("ai.oauthDeny", { product: client.product }, user.id);
    return clearCookie(NextResponse.redirect(target), request);
  }

  const allowPropose = canPropose && form.get("propose") === "on";
  const code = await issueAuthorizationCode({
    userId: user.id,
    oauthClientId: client.client.id,
    redirectUri: parsed.redirectUri,
    codeChallenge: parsed.codeChallenge,
    resource: parsed.resource,
    allowRead: true,
    allowPropose,
  });
  target.searchParams.set("code", code);
  await writeAudit("ai.oauthApprove", { product: client.product, propose: allowPropose }, user.id);
  return clearCookie(NextResponse.redirect(target), request);
}
