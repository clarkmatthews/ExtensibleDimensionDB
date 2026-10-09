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
  name: "housekeeping",
  everyMs: 6 * 60 * 60_000,
  run: async () => {
    const { prisma } = await import("@/lib/prisma");
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const [sessions, locks, blocks] = await Promise.all([
      prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: dayAgo } }] } }),
      prisma.loginLock.deleteMany({ where: { updatedAt: { lt: dayAgo } } }),
      prisma.apiIpBlock.deleteMany({ where: { updatedAt: { lt: dayAgo } } }),
    ]);
    return `removed ${sessions.count} sessions, ${locks.count} sign-in counters, ${blocks.count} API counters`;
  },
});

startScheduler();
