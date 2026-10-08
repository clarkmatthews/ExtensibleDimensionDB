import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSessionToken, readSessionToken, SESSION_COOKIE } from "@/lib/session-token";

export { SESSION_COOKIE };

export async function getCurrentUser() {
  const jar = await cookies();
  const userId = readSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return prisma.user.findFirst({
    where: { id: userId, isActive: true },
    include: { groups: { include: { group: true } } },
  });
}

export async function setSession(userId: string) {
  const jar = await cookies();
  const headerStore = await headers();
  const https = headerStore.get("x-forwarded-proto") === "https";
  jar.set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || https,
    path: "/",
    maxAge: 60 * 60 * 24 * 12,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
