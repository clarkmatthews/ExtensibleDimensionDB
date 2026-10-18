import { NextResponse } from "next/server";
import { clearSession, getCurrentUser } from "@/lib/session";

/**
 * Called by the browser while someone is typing or clicking, so their activity keeps them signed
 * in even when it sends no other request. Answers 401 once the sign-in has ended.
 */
export async function POST() {
  const user = await getCurrentUser({ touch: true });
  return new NextResponse(null, { status: user ? 204 : 401, headers: { "Cache-Control": "no-store" } });
}

/** Ends this browser's sign-in when the browser reaches the idle limit. */
export async function DELETE() {
  await clearSession();
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
