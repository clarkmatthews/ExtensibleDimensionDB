import { prisma } from "@/lib/prisma";

/**
 * Built-in scheduler for background jobs.
 *
 * Every app process starts it, but each run takes a Postgres advisory lock, so when several
 * servers share one database only one of them runs a job at a time. Disable it with
 * SCHEDULER=off when an outside scheduler calls the routes instead.
 */
type Job = { name: string; everyMs: number; run: () => Promise<string> };

const jobs: Job[] = [];
let started = false;

export function scheduleJob(job: Job) {
  jobs.push(job);
}

export function schedulerEnabled() {
  return !/^(0|off|false|no)$/i.test(process.env.SCHEDULER?.trim() ?? "");
}

/** Runs one job under a database-wide lock. Returns null when another server holds the lock. */
export async function runJobOnce(job: Job): Promise<string | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`job:${job.name}`})) AS locked`;
      if (!locked) return null;
      const result = await job.run();
      await tx.jobRun.upsert({
        where: { name: job.name },
        create: { name: job.name, lastRunAt: new Date(), lastResult: result.slice(0, 500) },
        update: { lastRunAt: new Date(), lastResult: result.slice(0, 500) },
      });
      return result;
    },
    { timeout: 5 * 60_000, maxWait: 10_000 },
  );
}

export function startScheduler() {
  if (started || !schedulerEnabled()) return;
  started = true;
  for (const job of jobs) {
    const tick = async () => {
      try {
        await runJobOnce(job);
      } catch (error) {
        console.error(`Scheduled job ${job.name} failed`, error);
      }
    };
    // First run shortly after start-up, then on the interval.
    setTimeout(tick, 15_000).unref?.();
    setInterval(tick, job.everyMs).unref?.();
  }
  console.log(`Scheduler started: ${jobs.map((job) => job.name).join(", ") || "no jobs"}.`);
}
