import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runJobOnce } from "@/lib/scheduler";
import { raiseOverdueAlerts } from "@/lib/workflow";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison; hashing first makes both sides the same length. */
function secretMatches(provided: string | null, expected: string) {
  if (!provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Optional trigger for an outside scheduler. The app already checks every 15 minutes
 * (OVERDUE_CHECK_MINUTES) unless SCHEDULER=off. Both paths share one lock, so a call here
 * while the built-in job is running is skipped rather than sending alerts twice.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.ALERT_SECRET?.trim();
  if (!secret || !secretMatches(request.headers.get("x-alert-secret"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let count = 0;
  const result = await runJobOnce({
    name: "overdue-alerts",
    everyMs: 0,
    run: async () => {
      count = await raiseOverdueAlerts();
      return `${count} overdue`;
    },
  });
  if (result === null) return NextResponse.json({ overdue: 0, skipped: "already running" });
  return NextResponse.json({ overdue: count });
}
