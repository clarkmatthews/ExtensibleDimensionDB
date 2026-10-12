import { scheduleJob, startScheduler } from "@/lib/scheduler";
import { raiseOverdueAlerts } from "@/lib/workflow";

const minutes = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return (Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback) * 60_000;
};

scheduleJob({
  name: "overdue-alerts",
  everyMs: minutes(process.env.OVERDUE_CHECK_MINUTES, 15),
  run: async () => `${await raiseOverdueAlerts()} overdue`,
});

scheduleJob({
  name: "webhooks",
  everyMs: 20_000,
  run: async () => {
    const { deliverDueWebhooks } = await import("@/lib/webhooks");
    return deliverDueWebhooks();
  },
});

scheduleJob({
  name: "housekeeping",
  everyMs: 6 * 60 * 60_000,
  run: async () => {
    const { prisma } = await import("@/lib/prisma");
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    const [sessions, locks, blocks, deliveries, imports] = await Promise.all([
      prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: dayAgo } }] } }),
      prisma.loginLock.deleteMany({ where: { updatedAt: { lt: dayAgo } } }),
      prisma.apiIpBlock.deleteMany({ where: { updatedAt: { lt: dayAgo } } }),
      prisma.webhookDelivery.deleteMany({ where: { status: { in: ["DELIVERED", "FAILED"] }, createdAt: { lt: monthAgo } } }),
      // Uploaded files are only needed between preview and confirmation.
      prisma.importJob.deleteMany({ where: { createdAt: { lt: dayAgo } } }),
    ]);
    const { cleanUpOauth } = await import("@/lib/mcp-oauth-flow");
    const oauth = await cleanUpOauth(now);
    return `removed ${sessions.count} sessions, ${locks.count} sign-in counters, ${blocks.count} API counters, ${deliveries.count} webhook deliveries, ${imports.count} import files, ${oauth.tokens} assistant tokens, ${oauth.codes} sign-in codes, ${oauth.refreshTokens} refresh tokens`;
  },
});

startScheduler();
