"use server";

import { compare, hash } from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { clientAddress } from "@/lib/client-address";
import { clearLoginFailures, loginBlockedUntil, noteLoginFailure } from "@/lib/login-throttle";
import { oauthResumePath, OAUTH_QUERY_COOKIE } from "@/lib/mcp-oauth";
import { passwordError } from "@/lib/passwords";
import { managesOwnPassword, mustChooseOwnPassword } from "@/lib/password-policy";
import { prisma } from "@/lib/prisma";
import { currentSessionId, getCurrentUser, revokeAllSessions } from "@/lib/session";
import { loadSsoSettings } from "@/lib/sso";

function back(error: string): never {
  redirect(`/account/password?error=${encodeURIComponent(error)}`);
}

export async function changeOwnPassword(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sso = await loadSsoSettings().catch(() => null);
  if (!managesOwnPassword(user, sso)) redirect("/dashboard");
  const forced = mustChooseOwnPassword(user, sso);
  const current = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  // The current password is checked like a sign-in, so this page cannot be used to guess it.
  const address = clientAddress(await headers());
  const blockedUntil = await loginBlockedUntil(user.email, address);
  if (blockedUntil) {
    const minutes = Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 60_000));
    back(`Too many attempts. Try again in ${minutes === 1 ? "1 minute" : `${minutes} minutes`}.`);
  }
  if (!(await compare(current, user.passwordHash))) {
    await noteLoginFailure(user.email, address);
    back("Your current password was not recognized.");
  }
  await clearLoginFailures(user.email, address);
  if (password !== confirmPassword) back("The new password and its confirmation do not match.");
  const invalid = passwordError(password, { name: user.name, email: user.email });
  if (invalid) back(invalid);
  if (await compare(password, user.passwordHash)) back("Choose a password different from your current one.");

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(password, 10), mustChangePassword: false },
  });
  // Other browsers are signed out; this one stays signed in.
  await revokeAllSessions(user.id, (await currentSessionId()) ?? undefined);
  await writeAudit("account.changePassword", { required: forced }, user.id);
  if (forced) redirect(oauthResumePath((await cookies()).get(OAUTH_QUERY_COOKIE)?.value) ?? "/dashboard");
  redirect("/account/password?saved=1");
}
