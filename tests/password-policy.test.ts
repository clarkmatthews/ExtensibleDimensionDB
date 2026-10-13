import { describe, expect, it } from "vitest";
import { managesOwnPassword, mustChooseOwnPassword, usesSso } from "@/lib/password-policy";

const person = { isAdmin: false, oidcSubject: null, mustChangePassword: true };
const ssoOn = { enabled: true, passwordAdminOnly: false };

describe("who manages their own password", () => {
  it("everyone does when single sign-on is off", () => {
    expect(managesOwnPassword(person, null)).toBe(true);
    expect(managesOwnPassword({ ...person, oidcSubject: "sub" }, { enabled: false, passwordAdminOnly: true })).toBe(true);
  });

  it("people who sign in through the provider do not", () => {
    expect(usesSso({ ...person, oidcSubject: "sub" }, ssoOn)).toBe(true);
    expect(usesSso({ ...person, isAdmin: true, oidcSubject: "sub" }, ssoOn)).toBe(true);
    expect(usesSso(person, ssoOn)).toBe(false);
  });

  it("only administrators keep passwords when password sign-in is limited to them", () => {
    const limited = { enabled: true, passwordAdminOnly: true };
    expect(managesOwnPassword(person, limited)).toBe(false);
    expect(managesOwnPassword({ ...person, isAdmin: true }, limited)).toBe(true);
  });
});

describe("choosing your own password at sign-in", () => {
  it("is required of a non-administrator whose password someone else set", () => {
    expect(mustChooseOwnPassword(person, null)).toBe(true);
    expect(mustChooseOwnPassword({ ...person, mustChangePassword: false }, null)).toBe(false);
  });

  it("is not required of administrators or of people using single sign-on", () => {
    expect(mustChooseOwnPassword({ ...person, isAdmin: true }, null)).toBe(false);
    expect(mustChooseOwnPassword({ ...person, oidcSubject: "sub" }, ssoOn)).toBe(false);
  });
});
