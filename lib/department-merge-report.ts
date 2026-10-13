import type { CategoryPermission, FieldPermission, GrantLevel, ModulePermission } from "@prisma/client";
import { NAV_MODULES } from "@/lib/nav-modules";
import { categoryAccessIn, fieldAccessIn, moduleAccessIn, type Tier } from "@/lib/permissions";

/**
 * Compares each person's access before and after departments were merged into groups.
 *
 * Before: the person's own grants, then their groups, then their department, each tier used only
 * when the ones above it said nothing. After: the person's own grants, then all their groups
 * together. A former department is now one of those groups, so a group that used to hold access
 * back below a department grant no longer does.
 */
export type MergeChange = { person: string; item: string; before: string; after: string };

type Person = { id: string; name: string; email: string; isAdmin: boolean; groupIds: string[] };

const RANK: Record<GrantLevel, number> = { NONE: 0, VIEW: 1, EDIT: 2 };
const fieldLevel = (access: { canView: boolean; canUpdate: boolean }) => (access.canUpdate ? "Edit" : access.canView ? "View" : "None");
const FIELD_RANK: Record<string, number> = { None: 0, View: 1, Edit: 2 };

export function departmentMergeChanges(input: {
  people: Person[];
  /** The groups that replaced departments. */
  departmentGroupIds: string[];
  categories: { id: string; name: string; fields: { id: string; friendlyName: string }[] }[];
  categoryPerms: CategoryPermission[];
  fieldPerms: FieldPermission[];
  modulePerms: ModulePermission[];
}): MergeChange[] {
  const changes: MergeChange[] = [];
  const departmentGroups = new Set(input.departmentGroupIds);
  for (const person of input.people) {
    if (person.isAdmin) continue;
    const ownGroups = person.groupIds.filter((id) => !departmentGroups.has(id));
    const formerDepartments = person.groupIds.filter((id) => departmentGroups.has(id));
    if (!formerDepartments.length) continue;
    const before: Tier[] = [
      { subjectType: "USER", ids: [person.id] },
      { subjectType: "GROUP", ids: ownGroups },
      { subjectType: "GROUP", ids: formerDepartments },
    ];
    const after: Tier[] = [
      { subjectType: "USER", ids: [person.id] },
      { subjectType: "GROUP", ids: person.groupIds },
    ];
    const label = `${person.name} (${person.email})`;
    for (const item of NAV_MODULES) {
      const was = moduleAccessIn(before, input.modulePerms, item.id);
      const now = moduleAccessIn(after, input.modulePerms, item.id);
      if (RANK[now] > RANK[was]) changes.push({ person: label, item: `Screen: ${item.label}`, before: was, after: now });
    }
    for (const category of input.categories) {
      const was = categoryAccessIn(before, input.categoryPerms, category.id);
      const now = categoryAccessIn(after, input.categoryPerms, category.id);
      for (const [key, name] of [
        ["canViewData", "view data"],
        ["canAddFields", "add attributes"],
        ["canRemoveFields", "hide attributes"],
        ["canEditFields", "edit attributes"],
        ["canEditCategory", "edit the dimension"],
        ["canAssignPermissions", "assign permissions"],
      ] as const) {
        if (now[key] && !was[key]) changes.push({ person: label, item: `${category.name}: ${name}`, before: "No", after: "Yes" });
      }
      for (const field of category.fields) {
        const wasField = fieldLevel(fieldAccessIn(before, input.categoryPerms, input.fieldPerms, field.id, category.id));
        const nowField = fieldLevel(fieldAccessIn(after, input.categoryPerms, input.fieldPerms, field.id, category.id));
        if (FIELD_RANK[nowField] > FIELD_RANK[wasField]) {
          changes.push({ person: label, item: `${category.name} › ${field.friendlyName}`, before: wasField, after: nowField });
        }
      }
    }
  }
  return changes;
}
