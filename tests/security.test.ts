import { describe, expect, it, vi } from "vitest";

// These modules import the Prisma client; the unit tests never touch the database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => null }));

import { auditDetail } from "@/lib/audit";
import { hashShareSecret, secretMatchesHash } from "@/lib/api-share";
import { nextFailureState, THROTTLE_RULES } from "@/lib/login-throttle";
import { canSeeValue, type AccessContext } from "@/lib/permissions";
import { createSessionToken, readSessionPayload, readSessionToken } from "@/lib/session-token";
import { hiddenChangeText } from "@/lib/workflow";

describe("share secrets", () => {
  it("matches the right secret against its hash and rejects others", () => {
    const hash = hashShareSecret("correct-horse-battery-staple");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(secretMatchesHash("correct-horse-battery-staple", hash)).toBe(true);
    expect(secretMatchesHash("wrong", hash)).toBe(false);
    expect(secretMatchesHash("", hash)).toBe(false);
  });

  it("produces the same hash as the database migration (SHA-256 hex of UTF-8)", () => {
    expect(hashShareSecret("abcdefSECRET1234")).toBe("7dbf8ac0a9a8744b0b9b96eb5790217b2e7de0d3f056027ed938182072008a20");
  });
});

describe("sign-in throttling", () => {
  const now = Date.UTC(2026, 9, 9, 12);
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);

  it("never blocks the account rule for longer than five minutes", () => {
    const state = nextFailureState({ failureCount: 500, updatedAt: at(0) }, THROTTLE_RULES.ACCOUNT, now);
    expect(state.blockedUntil!.getTime() - now).toBe(5 * 60_000);
  });

  it("allows five failures before slowing an account down, then starts at 30 seconds", () => {
    expect(nextFailureState({ failureCount: 4, updatedAt: at(1) }, THROTTLE_RULES.ACCOUNT, now).blockedUntil).toBeNull();
    const sixth = nextFailureState({ failureCount: 5, updatedAt: at(1) }, THROTTLE_RULES.ACCOUNT, now);
    expect(sixth.blockedUntil!.getTime() - now).toBe(30_000);
  });

  it("forgets failures after an hour", () => {
    const state = nextFailureState({ failureCount: 20, updatedAt: at(61) }, THROTTLE_RULES.ACCOUNT, now);
    expect(state).toEqual({ failureCount: 1, blockedUntil: null });
  });
});

describe("sessions", () => {
  it("round-trips a signed session token", () => {
    const expires = new Date(Date.now() + 60_000);
    const token = createSessionToken("session-1", "user-1", expires);
    expect(readSessionPayload(token)).toMatchObject({ sid: "session-1", userId: "user-1" });
    expect(readSessionToken(token)).toBe("user-1");
  });

  it("rejects tampered and expired tokens", () => {
    const token = createSessionToken("session-1", "user-1", new Date(Date.now() + 60_000));
    const [body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sid: "session-1", userId: "admin", exp: Date.now() + 60_000 })).toString("base64url");
    expect(readSessionToken(`${forged}.${signature}`)).toBeNull();
    expect(readSessionToken(`${body}.x${signature.slice(1)}`)).toBeNull();
    expect(readSessionToken(createSessionToken("s", "u", new Date(Date.now() - 1)))).toBeNull();
  });

  it("rejects tokens from before server-side sessions (no session id)", () => {
    const token = createSessionToken("", "user-1", new Date(Date.now() + 60_000));
    expect(readSessionToken(token)).toBeNull();
  });
});

describe("audit detail", () => {
  it("never records passwords or secrets", () => {
    const form = new FormData();
    form.set("name", "Pat");
    form.set("password", "Hunter2-Hunter2!");
    form.set("confirmPassword", "Hunter2-Hunter2!");
    form.set("smtpPassword", "");
    form.set("key", "store_code");
    const detail = JSON.stringify(auditDetail([form]));
    expect(detail).not.toContain("Hunter2");
    expect(detail).toContain("[changed]");
    expect(detail).toContain("store_code");
    expect(detail).not.toContain("smtpPassword");
  });
});

describe("change notifications", () => {
  const field = { fieldId: "f-salary", categoryId: "c-hr" };
  const base = {
    groupIds: [],
    departmentIds: [],
    fieldPerms: [],
    modulePerms: [],
  };
  const user = (isAdmin: boolean) => ({ id: "u1", isAdmin, groups: [] }) as unknown as AccessContext["user"];

  it("hides values from people who cannot view the attribute", () => {
    const ctx = { ...base, user: user(false), categoryPerms: [] } as unknown as AccessContext;
    expect(canSeeValue(ctx, field.fieldId, field.categoryId)).toBe(false);
    expect(hiddenChangeText("Pat")).not.toMatch(/salary|"/i);
  });

  it("shows values to people with view on the dimension", () => {
    const categoryPerms = [
      { categoryId: "c-hr", subjectType: "USER", subjectId: "u1", grantLevel: "VIEW", applyToFields: false, canViewData: true },
    ];
    const ctx = { ...base, user: user(false), categoryPerms } as unknown as AccessContext;
    expect(canSeeValue(ctx, field.fieldId, field.categoryId)).toBe(true);
  });

  it("always shows values to administrators", () => {
    const ctx = { ...base, user: user(true), categoryPerms: [] } as unknown as AccessContext;
    expect(canSeeValue(ctx, field.fieldId, field.categoryId)).toBe(true);
  });
});
