import { describe, expect, it } from "vitest";
import type { CategoryPermission, FieldPermission, ModulePermission } from "@prisma/client";
import { departmentMergeChanges } from "@/lib/department-merge-report";
import { fieldAccessIn, moduleAccessIn, type Tier } from "@/lib/permissions";

const category = (subjectId: string, extra: Partial<CategoryPermission> = {}) =>
  ({
    id: `c-${subjectId}`, categoryId: "cat", subjectType: "GROUP", subjectId, grantLevel: "NONE", applyToFields: false,
    canAddFields: false, canRemoveFields: false, canEditFields: false, canEditCategory: false, canAssignPermissions: false, canViewData: true,
    ...extra,
  }) as CategoryPermission;
const field = (subjectId: string, canView: boolean, canUpdate: boolean) =>
  ({ id: `f-${subjectId}`, fieldId: "phone", subjectType: "GROUP", subjectId, canView, canUpdate }) as FieldPermission;
const categories = [{ id: "cat", name: "General", fields: [{ id: "phone", friendlyName: "Phone" }] }];
const pat = { id: "u1", name: "Pat", email: "pat@example.com", isAdmin: false };

describe("department merge report", () => {
  it("finds a person whose group held back what the department granted", () => {
    // Store team (a group) sees Phone only; Operations (the former department) may edit it.
    const changes = departmentMergeChanges({
      people: [{ ...pat, groupIds: ["store-team", "dept_ops"] }],
      departmentGroupIds: ["dept_ops"],
      categories,
      categoryPerms: [category("store-team", { applyToFields: true }), category("dept_ops", { applyToFields: true })],
      fieldPerms: [field("store-team", true, false), field("dept_ops", true, true)],
      modulePerms: [],
    });
    expect(changes).toEqual([{ person: "Pat (pat@example.com)", item: "General › Phone", before: "View", after: "Edit" }]);
  });

  it("reports nothing when the department was the only source of access", () => {
    const changes = departmentMergeChanges({
      people: [{ ...pat, groupIds: ["store-team", "dept_ops"] }],
      departmentGroupIds: ["dept_ops"],
      categories,
      categoryPerms: [category("dept_ops", { applyToFields: true })],
      fieldPerms: [field("dept_ops", true, true)],
      modulePerms: [],
    });
    expect(changes).toEqual([]);
  });

  it("keeps a person's own grant above every group", () => {
    const tiers: Tier[] = [{ subjectType: "USER", ids: ["u1"] }, { subjectType: "GROUP", ids: ["g1", "g2"] }];
    const modules = [
      { id: "m1", module: "STORES", subjectType: "USER", subjectId: "u1", grantLevel: "VIEW" },
      { id: "m2", module: "STORES", subjectType: "GROUP", subjectId: "g1", grantLevel: "EDIT" },
      { id: "m3", module: "REPORTS", subjectType: "GROUP", subjectId: "g2", grantLevel: "VIEW" },
    ] as unknown as ModulePermission[];
    expect(moduleAccessIn(tiers, modules, "STORES")).toBe("VIEW");
    expect(moduleAccessIn(tiers, modules, "REPORTS" as never)).toBe("VIEW");
    const perms = [category("g1", { applyToFields: true }), category("g2", { applyToFields: true })];
    expect(fieldAccessIn(tiers, perms, [field("g1", true, false), field("g2", true, true)], "phone", "cat")).toEqual({ canView: true, canUpdate: true });
  });
});
