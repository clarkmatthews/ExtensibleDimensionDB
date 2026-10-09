"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { audited } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
const SETTINGS_ID = "default";

export async function saveSiteName(formData: FormData) {
  return audited("site.saveSiteName", [formData], async () => {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    const access = await loadAccess(user);
    if (!canEditModule(access, "SITE_CONFIG")) redirect("/admin/site?error=You%20cannot%20change%20the%20site%20name.");
    const name = String(formData.get("name") ?? "").trim();
    if (!name) redirect("/admin/site?error=Enter%20a%20site%20name.");
    if (name.length > 80) redirect("/admin/site?error=The%20site%20name%20must%20be%2080%20characters%20or%20fewer.");
    await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, name },
      update: { name },
    });
    revalidatePath("/", "layout");
    revalidatePath("/admin/site");
    revalidatePath("/login");
    redirect("/admin/site?saved=1");
  });
}
