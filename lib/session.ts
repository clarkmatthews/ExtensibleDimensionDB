import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSessionToken, readSessionPayload, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session-token";

export { SESSION_COOKIE };

/** How often lastSeenAt is refreshed, so a busy page does not write on every request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function getCurrentUser() {
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
    !session.user.isActive
  ) {
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
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
