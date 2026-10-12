import { NextResponse } from "next/server";
import { authorizationServerMetadata, OAUTH_CORS, publicOrigin } from "@/lib/mcp-oauth";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}

export function GET(request: Request) {
  return NextResponse.json(authorizationServerMetadata(publicOrigin(request.url)), { headers: OAUTH_CORS });
}
