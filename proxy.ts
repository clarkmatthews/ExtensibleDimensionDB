import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin } from "@/lib/public-origin";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session-token";

export function proxy(request: NextRequest) {
  const userId = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const path = request.nextUrl.pathname;
  // These routes authenticate themselves: share secrets, the alert secret, AI access tokens, and single sign-on.
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/api/alerts") ||
    path.startsWith("/api/share") ||
    path.startsWith("/api/auth/oidc/") ||
    path.startsWith("/.well-known/oauth-") ||
    path.startsWith("/oauth/metadata") ||
    path === "/oauth/register" ||
    path === "/oauth/token" ||
    path === "/oauth/authorize" ||
    path === "/api/mcp";
  if (!userId && !isPublic) {
    return NextResponse.redirect(new URL("/login", requestOrigin(request)));
  }
  if (userId && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", requestOrigin(request)));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
