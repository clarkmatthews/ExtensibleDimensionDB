import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

const { idleCutoff, sessionIdle } = await import("@/lib/session");

const MINUTE = 60 * 1000;
const now = Date.UTC(2026, 9, 18, 12, 0, 0);

describe("session idle limit", () => {
  it("ends a sign-in after the limit, allowing one minute for activity that has not been recorded yet", () => {
    expect(sessionIdle(new Date(now - 29 * MINUTE), 30, now)).toBe(false);
    expect(sessionIdle(new Date(now - 30.5 * MINUTE), 30, now)).toBe(false);
    expect(sessionIdle(new Date(now - 31.5 * MINUTE), 30, now)).toBe(true);
    expect(sessionIdle(new Date(now - 10.5 * MINUTE), 10, now)).toBe(false);
    expect(sessionIdle(new Date(now - 11.5 * MINUTE), 10, now)).toBe(true);
    expect(idleCutoff(30, now)?.getTime()).toBe(now - 31 * MINUTE);
  });

  it("never ends a sign-in for inactivity when the limit is 0", () => {
    expect(sessionIdle(new Date(now - 30 * 24 * 60 * MINUTE), 0, now)).toBe(false);
    expect(idleCutoff(0, now)).toBeNull();
  });
});
