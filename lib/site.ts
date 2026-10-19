import { cache } from "react";
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

/** The Site page's default idle limit for browser sign-ins, in minutes. */
export const DEFAULT_IDLE_MINUTES = 30;
/** The longest idle limit the Site page accepts: one day. 0 turns the limit off. */
export const MAX_IDLE_MINUTES = 1440;

/**
 * Minutes without activity before a browser sign-in ends, from the Site page. 0 means sign-ins
 * never time out. Read once per request. AI connections use their own tokens, not sign-ins,
 * so this never applies to them.
 */
export const sessionIdleMinutes = cache(async (): Promise<number> => {
  try {
    const row = await prisma.siteSettings.findUnique({ where: { id: "default" }, select: { sessionIdleMinutes: true } });
    const minutes = row?.sessionIdleMinutes ?? DEFAULT_IDLE_MINUTES;
    return Number.isFinite(minutes) && minutes >= 0 ? Math.min(MAX_IDLE_MINUTES, minutes) : DEFAULT_IDLE_MINUTES;
  } catch {
    return DEFAULT_IDLE_MINUTES;
  }
});
