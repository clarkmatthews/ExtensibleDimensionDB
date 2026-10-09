import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { raiseOverdueAlerts } from "@/lib/alerts";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison; hashing first makes both sides the same length. */
function secretMatches(provided: string | null, expected: string) {
  if (!provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

export async function POST(request: NextRequest) {
  const secret = process.env.ALERT_SECRET?.trim();
  if (!secret || !secretMatches(request.headers.get("x-alert-secret"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const count = await raiseOverdueAlerts();
  return NextResponse.json({ overdue: count });
}
