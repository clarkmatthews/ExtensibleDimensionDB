import { NextRequest, NextResponse } from "next/server";
import { raiseOverdueAlerts } from "@/lib/alerts";

export async function POST(request: NextRequest) {
  const secret = process.env.ALERT_SECRET;
  if (!secret || request.headers.get("x-alert-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const count = await raiseOverdueAlerts();
  return NextResponse.json({ overdue: count });
}
