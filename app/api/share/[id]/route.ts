import { NextRequest, NextResponse } from "next/server";
import {
  bearerSecret,
  blockedIpUntil,
  buildShare,
  clearSecretFailures,
  noteSecretFailure,
  outsideDateRange,
  recordShareRequest,
  secretMatchesHash,
  shareToXml,
  sourceIp,
} from "@/lib/api-share";
import { prisma } from "@/lib/prisma";

function errorBody(format: "JSON" | "XML", status: number, message: string) {
  if (format === "XML") {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<error>${message.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</error>\n`;
    return new NextResponse(xml, {
      status,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const endpoint = await prisma.apiEndpoint.findUnique({ where: { id } });
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ip = sourceIp(request);
  const format = endpoint.format;

  if (await blockedIpUntil(endpoint.id, ip)) {
    await recordShareRequest(endpoint.id, ip, 429, "blocked for 1 hour");
    return errorBody(format, 429, "This address is blocked for 1 hour after repeated secret failures.");
  }

  const provided = bearerSecret(request);
  const secretAccepted = endpoint.secretOptional && !provided ? true : secretMatchesHash(provided, endpoint.secretHash);
  if (!secretAccepted) {
    const failure = await noteSecretFailure(endpoint.id, ip);
    if (failure.blocked) {
      await recordShareRequest(endpoint.id, ip, 429, "blocked for 1 hour");
      return errorBody(format, 429, "This address is blocked for 1 hour after repeated secret failures.");
    }
    const result = failure.count ? `bad secret (${failure.count})` : "bad secret";
    await recordShareRequest(endpoint.id, ip, 401, result);
    return errorBody(format, 401, "Unauthorized");
  }
  if (!endpoint.isActive) {
    await recordShareRequest(endpoint.id, ip, 403, "disabled");
    return errorBody(format, 403, "This endpoint is disabled.");
  }
  if (outsideDateRange(endpoint.validFrom, endpoint.validTo)) {
    await recordShareRequest(endpoint.id, ip, 403, "outside the date range");
    return errorBody(format, 403, "This endpoint is outside its active dates.");
  }

  const payload = await buildShare(endpoint.id);
  await clearSecretFailures(endpoint.id, ip);
  await recordShareRequest(endpoint.id, ip, 200, "success");
  if (format === "XML") {
    return new NextResponse(shareToXml(payload), {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }
  return NextResponse.json(payload);
}
