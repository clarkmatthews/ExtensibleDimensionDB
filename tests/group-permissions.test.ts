import { describe, expect, it } from "vitest";
import type { CategoryPermission, FieldPermission } from "@prisma/client";
import { categoryAccessIn, fieldAccessIn, type Tier } from "@/lib/permissions";

const tiers: Tier[] = [{ subjectType: "USER", ids: ["pat"] }, { subjectType: "GROUP", ids: ["managers", "finance"] }];

const NO_RIGHTS = { canAddFields: false, canRemoveFields: false, canEditFields: false, canEditCategory: false, canAssignPermissions: false };
const UNSET_RIGHTS = { canAddFields: null, canRemoveFields: null, canEditFields: null, canEditCategory: null, canAssignPermissions: null };

const group = (subjectId: string, extra: Partial<CategoryPermission> = {}) =>
  ({ id: `c-${subjectId}`, categoryId: "cat", subjectType: "GROUP", subjectId, grantLevel: "NONE", applyToFields: false, canViewData: false, ...NO_RIGHTS, ...extra }) as CategoryPermission;
const own = (extra: Partial<CategoryPermission> = {}) =>
  ({ id: "c-pat", categoryId: "cat", subjectType: "USER", subjectId: "pat", grantLevel: null, applyToFields: false, canViewData: false, ...UNSET_RIGHTS, ...extra }) as CategoryPermission;
const field = (subjectType: "USER" | "GROUP", subjectId: string, fieldId: string, canView: boolean, canUpdate: boolean) =>
  ({ id: `f-${subjectId}-${fieldId}`, fieldId, subjectType, subjectId, canView, canUpdate }) as FieldPermission;

const level = (access: { canView: boolean; canUpdate: boolean }) => (access.canUpdate ? "EDIT" : access.canView ? "VIEW" : "NONE");

describe("groups with per-person exceptions", () => {
  const groups = [group("managers", { grantLevel: "VIEW", canViewData: true, canEditFields: true }), group("finance", { grantLevel: "EDIT", canViewData: true })];

  it("combines a person's groups when they have no settings of their own", () => {
    const rights = categoryAccessIn(tiers, groups, "cat");
    expect(rights.canViewData).toBe(true);
    expect(rights.canEditFields).toBe(true);
    expect(rights.canAddFields).toBe(false);
    expect(level(fieldAccessIn(tiers, groups, [], "phone", "cat"))).toBe("EDIT");
  });

  it("overrides one admin right and leaves the others to the groups", () => {
    const perms = [...groups, own({ canEditFields: false, canAddFields: true })];
    const rights = categoryAccessIn(tiers, perms, "cat");
    expect(rights.canEditFields).toBe(false);
    expect(rights.canAddFields).toBe(true);
    // Data was not touched, so it still comes from the groups.
    expect(rights.canViewData).toBe(true);
    expect(level(fieldAccessIn(tiers, perms, [], "phone", "cat"))).toBe("EDIT");
  });

  it("takes a single attribute away while the rest follow the groups", () => {
    const perms = [...groups, own({ applyToFields: true, canViewData: true })];
    const fields = [field("USER", "pat", "salary", false, false)];
    expect(categoryAccessIn(tiers, perms, "cat").canViewData).toBe(true);
    expect(level(fieldAccessIn(tiers, perms, fields, "salary", "cat"))).toBe("NONE");
    expect(level(fieldAccessIn(tiers, perms, fields, "phone", "cat"))).toBe("EDIT");
  });

  it("sets one level for the whole dimension, including None", () => {
    expect(level(fieldAccessIn(tiers, [...groups, own({ grantLevel: "VIEW" })], [], "phone", "cat"))).toBe("VIEW");
    const hidden = [...groups, own({ grantLevel: "NONE" })];
    expect(categoryAccessIn(tiers, hidden, "cat").canViewData).toBe(false);
    expect(level(fieldAccessIn(tiers, hidden, [], "phone", "cat"))).toBe("NONE");
  });

  it("gives access the groups do not", () => {
    const perms = [own({ applyToFields: true, canViewData: true, canAssignPermissions: true })];
    const fields = [field("USER", "pat", "phone", true, false)];
    expect(categoryAccessIn(tiers, perms, "cat")).toMatchObject({ canViewData: true, canAssignPermissions: true, canEditFields: false });
    expect(level(fieldAccessIn(tiers, perms, fields, "phone", "cat"))).toBe("VIEW");
    expect(level(fieldAccessIn(tiers, perms, fields, "email", "cat"))).toBe("NONE");
  });
});
