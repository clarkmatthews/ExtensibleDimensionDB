"use server";

import { compare } from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientAddress } from "@/lib/client-address";
import { clearLoginFailures, loginBlocked, noteLoginFailure } from "@/lib/login-throttle";
import { prisma } from "@/lib/prisma";
import { clearSession, setSession } from "@/lib/session";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const address = clientAddress(await headers());
  if (await loginBlocked(email, address)) redirect("/login?error=locked");
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
    redirect(locked ? "/login?error=locked" : "/login?error=1");
  }
  await clearLoginFailures(email, address);
  await setSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await clearSession();
  redirect("/login");
}
