import { prisma } from "@/lib/prisma";

export const DEFAULT_SITE_NAME = "Dimension database";

export async function siteName() {
  try {
    const row = await prisma.siteSettings.findUnique({ where: { id: "default" }, select: { name: true } });
    const name = row?.name.trim();
    return name || DEFAULT_SITE_NAME;
  } catch {
    return DEFAULT_SITE_NAME;
  }
}
