import { NextResponse } from "next/server";
import { OAUTH_CORS, protectedResourceMetadata, publicOrigin } from "@/lib/mcp-oauth";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}

export function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(publicOrigin(request.url)), { headers: OAUTH_CORS });
}
