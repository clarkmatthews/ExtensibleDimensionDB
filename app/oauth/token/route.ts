import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { OAUTH_CORS, publicOrigin } from "@/lib/mcp-oauth";
import { exchangeAuthorizationCode, exchangeRefreshToken } from "@/lib/mcp-oauth-flow";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}

async function form(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await request.json()) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(json)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

function failed(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: OAUTH_CORS });
}

/** Authorization-code and refresh-token grants. Public clients send the client id in the body. */
export async function POST(request: NextRequest) {
  const params = await form(request);
  const origin = publicOrigin(request.url);
  const clientId = params.get("client_id")?.trim() ?? "";
  const resource = params.get("resource");
  if (!clientId) return failed("invalid_client");
  const grant = params.get("grant_type");
  if (grant === "authorization_code") {
    const result = await exchangeAuthorizationCode({
      code: params.get("code")?.trim() ?? "",
      clientId,
      redirectUri: params.get("redirect_uri")?.trim() ?? "",
      codeVerifier: params.get("code_verifier")?.trim() ?? "",
      resource,
      origin,
    });
    if (!result.ok) return failed(result.error);
    if (result.replaced) await writeAudit("ai.oauthReplace", { product: result.product, replaced: result.replaced }, result.userId);
    return NextResponse.json(result.token, { headers: OAUTH_CORS });
  }
  if (grant === "refresh_token") {
    const result = await exchangeRefreshToken({
      refreshToken: params.get("refresh_token")?.trim() ?? "",
      clientId,
      resource,
      origin,
    });
    if (!result.ok) {
      if ("reused" in result && result.reused) {
        await writeAudit("ai.oauthRefreshReuse", { connectionId: result.connectionId }, result.userId);
      }
      return failed(result.error);
    }
    return NextResponse.json(result.token, { headers: OAUTH_CORS });
  }
  return failed("unsupported_grant_type");
}
