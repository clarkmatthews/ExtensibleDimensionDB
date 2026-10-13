import { NextResponse, type NextRequest } from "next/server";
import { resolveOauthClient } from "@/lib/mcp-oauth-flow";
import { OAUTH_QUERY_COOKIE, oauthMessage, parseAuthorizeQuery, publicOrigin, sealOauthQuery } from "@/lib/mcp-oauth";
import { getCurrentUser } from "@/lib/session";

function html(message: string) {
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sign-in</title><body style="font-family:sans-serif;padding:2rem"><p>${message}</p></body></html>`;
  return new Response(body, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Starts assistant sign-in. The query is sealed so a later login returns here and nowhere else. */
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const parsed = parseAuthorizeQuery(request.nextUrl.searchParams, origin);
  if (!parsed.ok) return html(oauthMessage("invalid"));
  const client = await resolveOauthClient(parsed);
  if (!client.ok) return html(oauthMessage(client.reason));
  const user = await getCurrentUser();
  const response = NextResponse.redirect(new URL(user ? "/oauth/consent" : "/login", origin));
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  response.cookies.set(OAUTH_QUERY_COOKIE, sealOauthQuery(request.nextUrl.searchParams.toString()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || https,
    path: "/",
    maxAge: 600,
  });
  return response;
}
