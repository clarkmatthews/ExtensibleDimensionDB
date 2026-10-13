import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ free: true, updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    jobRun: {
      createMany: async () => ({ count: 1 }),
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updates.push(args);
        // The claim is the update that sets a lease; it succeeds only when the lease is free.
        if (args.data.lockedUntil) return { count: state.free ? 1 : 0 };
        return { count: 1 };
      },
    },
    $transaction: async () => {
      throw new Error("jobs must not hold a transaction open");
    },
  },
}));

import { runJobOnce, schedulerEnabled } from "@/lib/scheduler";

afterEach(() => {
  state.free = true;
  state.updates = [];
  delete process.env.SCHEDULER;
});

describe("scheduler", () => {
  it("claims a lease, runs the job, and releases the lease with the result", async () => {
    const run = vi.fn(async () => "3 overdue");
    expect(await runJobOnce({ name: "overdue-alerts", everyMs: 1000, run })).toBe("3 overdue");
    expect(run).toHaveBeenCalledOnce();
    const [claim, done] = state.updates;
    expect(claim.data.lockedUntil).toBeInstanceOf(Date);
    expect(done.where.lockedBy).toBe(claim.data.lockedBy);
    expect(done.data).toMatchObject({ lastResult: "3 overdue", lockedUntil: null, lockedBy: null });
  });

  it("skips the job when another run holds the lease", async () => {
    state.free = false;
    const run = vi.fn(async () => "ran");
    expect(await runJobOnce({ name: "overdue-alerts", everyMs: 1000, run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
  });

  it("releases the lease when the job fails, so the next run is not blocked", async () => {
    const run = vi.fn(async () => {
      throw new Error("mail server down");
    });
    await expect(runJobOnce({ name: "webhooks", everyMs: 1000, run })).rejects.toThrow("mail server down");
    expect(state.updates.at(-1)?.data).toMatchObject({ lastResult: "failed: mail server down", lockedUntil: null });
  });

  it("is on unless SCHEDULER turns it off", () => {
    expect(schedulerEnabled()).toBe(true);
    process.env.SCHEDULER = "off";
    expect(schedulerEnabled()).toBe(false);
    process.env.SCHEDULER = "on";
    expect(schedulerEnabled()).toBe(true);
  });
});
