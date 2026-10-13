import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Built-in scheduler for background jobs.
 *
 * Every app process starts it. Before a run, a server claims the job with a short lease on its
 * JobRun row, so when several servers share one database only one of them runs a job at a time.
 * The lease is a plain row update: no database connection is held while the job runs, so jobs
 * never starve sign-ins and page loads of connections. Disable it with SCHEDULER=off when an
 * outside scheduler calls the routes instead.
 */
type Job = { name: string; everyMs: number; run: () => Promise<string>; leaseMs?: number };

/** How long a claim lasts if the server running the job dies before releasing it. */
const DEFAULT_LEASE_MS = 10 * 60_000;

const jobs: Job[] = [];
let started = false;

export function scheduleJob(job: Job) {
  jobs.push(job);
}

export function schedulerEnabled() {
  return !/^(0|off|false|no)$/i.test(process.env.SCHEDULER?.trim() ?? "");
}

async function release(name: string, owner: string, result: string) {
  await prisma.jobRun.updateMany({
    where: { name, lockedBy: owner },
    data: { lastRunAt: new Date(), lastResult: result.slice(0, 500), lockedUntil: null, lockedBy: null },
  });
}

/** Runs one job under a database-wide lease. Returns null when another run holds the lease. */
export async function runJobOnce(job: Job): Promise<string | null> {
  const owner = randomUUID();
  const now = new Date();
  await prisma.jobRun.createMany({ data: [{ name: job.name }], skipDuplicates: true });
  const claimed = await prisma.jobRun.updateMany({
    where: { name: job.name, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + (job.leaseMs ?? DEFAULT_LEASE_MS)), lockedBy: owner },
  });
  if (claimed.count !== 1) return null;
  let result: string;
  try {
    result = await job.run();
  } catch (error) {
    await release(job.name, owner, `failed: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
    throw error;
  }
  await release(job.name, owner, result);
  return result;
}

export function startScheduler() {
  if (started || !schedulerEnabled()) return;
  started = true;
  jobs.forEach((job, index) => {
    let running = false;
    const tick = async () => {
      // A slow run is not started again on top of itself by the next interval.
      if (running) return;
      running = true;
      try {
        await runJobOnce(job);
      } catch (error) {
        console.error(`Scheduled job ${job.name} failed`, error);
      } finally {
        running = false;
      }
    };
    // First runs are spread out after start-up, then each job repeats on its interval.
    setTimeout(tick, 15_000 + index * 5_000).unref?.();
    setInterval(tick, job.everyMs).unref?.();
  });
  console.log(`Scheduler started: ${jobs.map((job) => job.name).join(", ") || "no jobs"}.`);
}
