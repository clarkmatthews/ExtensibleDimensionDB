import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSessionToken, readSessionPayload, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session-token";

export { SESSION_COOKIE };

/** How often lastSeenAt is refreshed, so a busy page does not write on every request. */
const TOUCH_INTERVAL_MS = 60 * 1000;

/**
 * Minutes without activity before a sign-in ends: 30 unless SESSION_IDLE_MINUTES says otherwise
 * (5 to 1440). Activity is any page or request, and the browser reports typing and clicking too,
 * so someone filling in a long form is not signed out.
 */
export function idleMinutes() {
  const configured = Number.parseInt(process.env.SESSION_IDLE_MINUTES?.trim() ?? "", 10);
  return Number.isFinite(configured) ? Math.min(1440, Math.max(5, configured)) : 30;
}

/**
 * True when a session has gone longer than the idle limit without activity. The server allows one
 * extra minute because activity is recorded about once a minute, so it never ends a sign-in
 * before the browser has shown its warning.
 */
export function sessionIdle(lastSeenAt: Date, now = Date.now()) {
  return now - lastSeenAt.getTime() > idleMinutes() * 60 * 1000 + TOUCH_INTERVAL_MS;
}

/** Sessions last active before this moment have ended from inactivity. */
export function idleCutoff(now = Date.now()) {
  return new Date(now - idleMinutes() * 60 * 1000 - TOUCH_INTERVAL_MS);
}

/** The signed-in person, or null. With touch, the session's activity time is always recorded. */
export async function getCurrentUser(options: { touch?: boolean } = {}) {
  const jar = await cookies();
  const payload = readSessionPayload(jar.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { include: { groups: { include: { group: true } } } } },
  });
  const now = Date.now();
  if (
    !session ||
    session.userId !== payload.userId ||
    session.revokedAt ||
    session.expiresAt.getTime() <= now ||
    sessionIdle(session.lastSeenAt, now) ||
    !session.user.isActive
  ) {
    return null;
  }
  if (options.touch || now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  }
  return session.user;
}

export async function setSession(userId: string) {
  const jar = await cookies();
  const headerStore = await headers();
  const https = headerStore.get("x-forwarded-proto") === "https";
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: { userId, expiresAt, userAgent: (headerStore.get("user-agent") ?? "").slice(0, 300) },
  });
  jar.set(SESSION_COOKIE, createSessionToken(session.id, userId, expiresAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || https,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/**
 * Why this browser's sign-in ended, for the sign-in page: "idle" after the inactivity limit,
 * "ended" when it was signed out elsewhere or expired. Null when there is no ended sign-in.
 */
export async function endedSessionReason(): Promise<"idle" | "ended" | null> {
  const jar = await cookies();
  const payload = readSessionPayload(jar.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const session = await prisma.session.findUnique({ where: { id: payload.sid }, select: { revokedAt: true, lastSeenAt: true, expiresAt: true } });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return "ended";
  return sessionIdle(session.lastSeenAt) ? "idle" : null;
}

/** Signs out this browser: revokes its session row and removes the cookie. */
export async function clearSession() {
  const jar = await cookies();
  const payload = readSessionPayload(jar.get(SESSION_COOKIE)?.value);
  if (payload) {
    await prisma.session.updateMany({ where: { id: payload.sid, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
}

/** Signs a person out everywhere. Used after a password change, deactivation, or on request. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/** The session id of the current browser, when it has one. */
export async function currentSessionId() {
  const jar = await cookies();
  return readSessionPayload(jar.get(SESSION_COOKIE)?.value)?.sid ?? null;
}
