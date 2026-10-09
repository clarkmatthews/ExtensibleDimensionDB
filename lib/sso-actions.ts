"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audited } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/mail";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { loadSsoSettings, providerConfig } from "@/lib/sso";

const PAGE = "/admin/sso";

function back(query: string): never {
  redirect(`${PAGE}?${query}`);
}

async function editor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canEditModule(await loadAccess(user), "SSO")) back(`error=${encodeURIComponent("You cannot change single sign-on.")}`);
  return user;
}

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function saveSsoSettings(formData: FormData) {
  return audited("sso.save", [formData], async () => {
    const user = await editor();
    const issuer = text(formData, "issuer");
    const clientId = text(formData, "clientId");
    const typedSecret = String(formData.get("clientSecret") ?? "");
    const enabled = formData.get("enabled") === "on";
    const passwordAdminOnly = formData.get("passwordAdminOnly") === "on";
    const allowedDomains = text(formData, "allowedDomains")
      .split(/[\s,]+/)
      .map((domain) => domain.toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    if (issuer) {
      try {
        const url = new URL(issuer);
        if (url.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) back(`error=${encodeURIComponent("The issuer must use https://.")}`);
      } catch {
        back(`error=${encodeURIComponent("Enter the issuer as a full URL.")}`);
      }
    }
    if (enabled && (!issuer || !clientId)) back(`error=${encodeURIComponent("Enter the issuer and client ID before turning single sign-on on.")}`);
    if (passwordAdminOnly && !user.isAdmin) back(`error=${encodeURIComponent("Only an administrator can limit password sign-in.")}`);
    const existing = await loadSsoSettings();
    const clientSecret = typedSecret ? encryptSecret(typedSecret) : (existing?.clientSecret ?? "");
    if (enabled && !clientSecret) back(`error=${encodeURIComponent("Enter the client secret.")}`);
    const defaultGroupId = text(formData, "defaultGroupId") || null;
    const data = {
      enabled,
      issuer,
      clientId,
      clientSecret,
      buttonLabel: text(formData, "buttonLabel").slice(0, 60) || "Sign in with SSO",
      allowedDomains,
      createUsers: formData.get("createUsers") === "on",
      defaultGroupId,
      passwordAdminOnly,
    };
    await prisma.ssoSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
    revalidatePath(PAGE);
    revalidatePath("/login");
    back("saved=1");
  });
}

/** Checks that the issuer answers OpenID Connect discovery with the saved settings. */
export async function testSsoSettings() {
  await editor();
  const settings = await loadSsoSettings();
  if (!settings?.issuer || !settings.clientId) back(`error=${encodeURIComponent("Save the issuer and client ID first.")}`);
  let secret = "";
  try {
    secret = decryptSecret(settings.clientSecret);
  } catch {
    back(`error=${encodeURIComponent("The saved client secret could not be read. Enter it again.")}`);
  }
  let issuer = "";
  try {
    const { config } = await providerConfig(settings, secret);
    issuer = config.serverMetadata().issuer;
  } catch {
    back(`error=${encodeURIComponent("Discovery failed: the issuer did not return OpenID Connect configuration. Check the issuer URL.")}`);
  }
  back(`tested=${encodeURIComponent(issuer)}`);
}
