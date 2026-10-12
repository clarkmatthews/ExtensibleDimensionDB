"use server";

import { compare } from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientAddress } from "@/lib/client-address";
import { clearLoginFailures, loginBlockedUntil, noteLoginFailure } from "@/lib/login-throttle";
import { oauthResumePath, OAUTH_QUERY_COOKIE } from "@/lib/mcp-oauth";
import { writeAudit } from "@/lib/audit";
import { loadSsoSettings } from "@/lib/sso";
import { prisma } from "@/lib/prisma";
import { clearSession, setSession } from "@/lib/session";

function lockedUrl(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `/login?error=locked&wait=${minutes}`;
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const address = clientAddress(await headers());
  const blockedUntil = await loginBlockedUntil(email, address);
  if (blockedUntil) redirect(lockedUrl(blockedUntil));
  let user;
  try {
    user = await prisma.user.findUnique({ where: { email } });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "P2021") redirect("/login?error=setup");
    throw error;
  }
  if (!user || !user.isActive || !(await compare(password, user.passwordHash))) {
    const locked = await noteLoginFailure(email, address);
    redirect(locked ? lockedUrl(locked) : "/login?error=1");
  }
  await clearLoginFailures(email, address);
  const sso = await loadSsoSettings().catch(() => null);
  if (sso?.enabled && sso.passwordAdminOnly && !user.isAdmin) redirect("/login?error=sso-only");
  await setSession(user.id);
  await writeAudit("session.signIn", { address }, user.id);
  redirect(oauthResumePath((await cookies()).get(OAUTH_QUERY_COOKIE)?.value) ?? "/dashboard");
}

export async function logout() {
  await clearSession();
  redirect("/login");
}
