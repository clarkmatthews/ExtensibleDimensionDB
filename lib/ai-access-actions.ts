"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newToken } from "@/lib/access-tokens";
import { NEW_TOKEN_COOKIE } from "@/lib/ai-access-cookie";
import { audited } from "@/lib/audit";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

const PAGE = "/ai-access";
const EXPIRY_DAYS = new Set([30, 90, 365, 0]);

function back(query: string): never {
  redirect(`${PAGE}?${query}`);
}

async function member() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "AI_ACCESS")) back(`error=${encodeURIComponent("You cannot use AI access.")}`);
  return { user, access };
}

/** Creates a token for the signed-in person. The token is shown once on the next page load. */
export async function createAccessToken(formData: FormData) {
  return audited("ai.createToken", [formData], async () => {
    const { user, access } = await member();
    const name = String(formData.get("name") ?? "").trim().slice(0, 80);
    if (!name) back(`error=${encodeURIComponent("Name the token after the assistant or computer that will use it.")}`);
    const wantsPropose = formData.get("propose") === "on";
    if (wantsPropose && !(canEditModule(access, "AI_ACCESS") && canEditModule(access, "STORES"))) {
      back(`error=${encodeURIComponent("Proposing changes needs edit access to AI access and to Dimension.")}`);
    }
    const days = Number(formData.get("expires") ?? 90);
    const expiry = EXPIRY_DAYS.has(days) ? days : 90;
    const issued = newToken();
    const created = await prisma.accessToken.create({
      data: {
        userId: user.id,
        name,
        tokenHash: issued.hash,
        prefix: issued.prefix,
        scopes: wantsPropose ? ["read", "propose"] : ["read"],
        expiresAt: expiry ? new Date(Date.now() + expiry * 24 * 60 * 60_000) : null,
      },
    });
    (await cookies()).set(NEW_TOKEN_COOKIE, `${created.id}:${issued.token}`, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: PAGE,
      maxAge: 120,
    });
    revalidatePath(PAGE);
    back("saved=created");
  });
}

/** Revokes a token. People revoke their own; administrators can revoke anyone's. */
export async function revokeAccessToken(formData: FormData) {
  return audited("ai.revokeToken", [formData], async () => {
    const { user } = await member();
    const id = String(formData.get("id") ?? "");
    const token = await prisma.accessToken.findUnique({ where: { id } });
    if (!token || (token.userId !== user.id && !user.isAdmin)) back(`error=${encodeURIComponent("That token was not found.")}`);
    await prisma.accessToken.update({ where: { id }, data: { revokedAt: new Date() } });
    revalidatePath(PAGE);
    back("saved=revoked");
  });
}
