import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { OAUTH_CORS } from "@/lib/mcp-oauth";
import { registerOauthClient } from "@/lib/mcp-oauth-flow";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}

/** Dynamic client registration for a public assistant whose redirect host is enabled. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400, headers: OAUTH_CORS });
  }
  const result = await registerOauthClient(body);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: result.reason }, { status: 400, headers: OAUTH_CORS });
  }
  await writeAudit("ai.oauthRegister", { product: result.product }, null);
  return NextResponse.json(result.body, { status: 201, headers: OAUTH_CORS });
}
