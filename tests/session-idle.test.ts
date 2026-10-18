import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

const { idleCutoff, idleMinutes, sessionIdle } = await import("@/lib/session");

const MINUTE = 60 * 1000;

describe("session idle limit", () => {
  afterEach(() => {
    delete process.env.SESSION_IDLE_MINUTES;
  });

  it("defaults to 30 minutes and keeps a setting between 5 and 1440", () => {
    expect(idleMinutes()).toBe(30);
    process.env.SESSION_IDLE_MINUTES = "45";
    expect(idleMinutes()).toBe(45);
    process.env.SESSION_IDLE_MINUTES = "1";
    expect(idleMinutes()).toBe(5);
    process.env.SESSION_IDLE_MINUTES = "99999";
    expect(idleMinutes()).toBe(1440);
    process.env.SESSION_IDLE_MINUTES = "soon";
    expect(idleMinutes()).toBe(30);
  });

  it("ends a sign-in after the limit, allowing one minute for activity that has not been recorded yet", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0);
    expect(sessionIdle(new Date(now - 29 * MINUTE), now)).toBe(false);
    expect(sessionIdle(new Date(now - 30.5 * MINUTE), now)).toBe(false);
    expect(sessionIdle(new Date(now - 31.5 * MINUTE), now)).toBe(true);
    expect(idleCutoff(now).getTime()).toBe(now - 31 * MINUTE);
  });
});
