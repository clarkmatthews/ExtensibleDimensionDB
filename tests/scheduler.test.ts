import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ locked: true, upserts: [] as unknown[] }));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async () => [{ locked: state.locked }],
    jobRun: { upsert: async (args: unknown) => state.upserts.push(args) },
  };
  return { prisma: { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } };
});

import { runJobOnce, schedulerEnabled } from "@/lib/scheduler";

afterEach(() => {
  state.locked = true;
  state.upserts = [];
  delete process.env.SCHEDULER;
});

describe("scheduler", () => {
  it("runs a job and records the result when it gets the lock", async () => {
    const run = vi.fn(async () => "3 overdue");
    expect(await runJobOnce({ name: "overdue-alerts", everyMs: 1000, run })).toBe("3 overdue");
    expect(run).toHaveBeenCalledOnce();
    expect(state.upserts).toHaveLength(1);
  });

  it("skips the job when another server holds the lock", async () => {
    state.locked = false;
    const run = vi.fn(async () => "ran");
    expect(await runJobOnce({ name: "overdue-alerts", everyMs: 1000, run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(state.upserts).toHaveLength(0);
  });

  it("is on unless SCHEDULER turns it off", () => {
    expect(schedulerEnabled()).toBe(true);
    process.env.SCHEDULER = "off";
    expect(schedulerEnabled()).toBe(false);
    process.env.SCHEDULER = "on";
    expect(schedulerEnabled()).toBe(true);
  });
});
