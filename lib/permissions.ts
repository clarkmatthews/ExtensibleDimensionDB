import type { CategoryPermission, FieldPermission, GrantLevel, ModulePermission, User } from "@prisma/client";
import { NAV_MODULES, type NavModuleId } from "@/lib/nav-modules";
import { prisma } from "@/lib/prisma";

export type CategoryAccess = {
  canAddFields: boolean;
  canRemoveFields: boolean;
  canEditFields: boolean;
  canEditCategory: boolean;
  canAssignPermissions: boolean;
  canViewData: boolean;
};

export type FieldAccess = { canView: boolean; canUpdate: boolean };

const NO_CATEGORY: CategoryAccess = {
  canAddFields: false,
  canRemoveFields: false,
  canEditFields: false,
  canEditCategory: false,
  canAssignPermissions: false,
  canViewData: false,
};

const ALL_CATEGORY: CategoryAccess = {
  canAddFields: true,
  canRemoveFields: true,
  canEditFields: true,
  canEditCategory: true,
  canAssignPermissions: true,
  canViewData: true,
};

function unionCategory(left: CategoryAccess, right: CategoryAccess): CategoryAccess {
  return {
    canAddFields: left.canAddFields || right.canAddFields,
    canRemoveFields: left.canRemoveFields || right.canRemoveFields,
    canEditFields: left.canEditFields || right.canEditFields,
    canEditCategory: left.canEditCategory || right.canEditCategory,
    canAssignPermissions: left.canAssignPermissions || right.canAssignPermissions,
    canViewData: left.canViewData || right.canViewData,
  };
}

function unionField(left: FieldAccess, right: FieldAccess): FieldAccess {
  return {
    canView: left.canView || right.canView,
    canUpdate: left.canUpdate || right.canUpdate,
  };
}

export type AccessUser = User & {
  groups: { groupId: string; group: { departmentId: string | null } }[];
};

export type AccessContext = {
  user: AccessUser;
  groupIds: string[];
  departmentIds: string[];
  categoryPerms: CategoryPermission[];
  fieldPerms: FieldPermission[];
  modulePerms: ModulePermission[];
};

export async function loadAccess(user: AccessUser): Promise<AccessContext> {
  const groupIds = user.groups.map((membership) => membership.groupId);
  const departmentIds = [
    ...new Set(
      user.groups
        .map((membership) => membership.group.departmentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [categoryPerms, fieldPerms, modulePerms] = await Promise.all([
    prisma.categoryPermission.findMany(),
    prisma.fieldPermission.findMany(),
    prisma.modulePermission.findMany(),
  ]);
  return { user, groupIds, departmentIds, categoryPerms, fieldPerms, modulePerms };
}

function strongestLevel(rows: { grantLevel: GrantLevel }[]): GrantLevel {
  if (rows.some((row) => row.grantLevel === "EDIT")) return "EDIT";
  if (rows.some((row) => row.grantLevel === "VIEW")) return "VIEW";
  return "NONE";
}

export function moduleAccess(ctx: AccessContext, moduleId: NavModuleId): GrantLevel {
  if (ctx.user.isAdmin) return "EDIT";
  const userRows = ctx.modulePerms.filter(
    (row) => row.module === moduleId && row.subjectType === "USER" && row.subjectId === ctx.user.id,
  );
  if (userRows.length) return strongestLevel(userRows);
  const departmentRows = ctx.modulePerms.filter(
    (row) => row.module === moduleId && row.subjectType === "DEPARTMENT" && ctx.departmentIds.includes(row.subjectId),
  );
  if (departmentRows.length) return strongestLevel(departmentRows);
  return "NONE";
}

export function canViewModule(ctx: AccessContext, moduleId: NavModuleId) {
  return moduleAccess(ctx, moduleId) !== "NONE";
}

export function canEditModule(ctx: AccessContext, moduleId: NavModuleId) {
  return moduleAccess(ctx, moduleId) === "EDIT";
}

export function firstModuleHref(ctx: AccessContext) {
  return NAV_MODULES.find((item) => canViewModule(ctx, item.id))?.href ?? null;
}

function pickTier<T extends { subjectType: string; subjectId: string }>(
  rows: T[],
  userId: string,
  groupIds: string[],
  departmentIds: string[],
): T[] | null {
  const userRows = rows.filter((row) => row.subjectType === "USER" && row.subjectId === userId);
  if (userRows.length) return userRows;
  const groupRows = rows.filter((row) => row.subjectType === "GROUP" && groupIds.includes(row.subjectId));
  if (groupRows.length) return groupRows;
  const departmentRows = rows.filter(
    (row) => row.subjectType === "DEPARTMENT" && departmentIds.includes(row.subjectId),
  );
  if (departmentRows.length) return departmentRows;
  return null;
}

export function categoryAccess(ctx: AccessContext, categoryId: string): CategoryAccess {
  if (ctx.user.isAdmin) return ALL_CATEGORY;
  const tier = pickTier(
    ctx.categoryPerms.filter((row) => row.categoryId === categoryId),
    ctx.user.id,
    ctx.groupIds,
    ctx.departmentIds,
  );
  if (!tier) return NO_CATEGORY;
  return tier.reduce<CategoryAccess>(
    (access, row) =>
      unionCategory(access, {
        canAddFields: row.canAddFields,
        canRemoveFields: row.canRemoveFields,
        canEditFields: row.canEditFields,
        canEditCategory: row.canEditCategory,
        canAssignPermissions: row.canAssignPermissions,
        canViewData: row.canViewData || row.grantLevel === "VIEW" || row.grantLevel === "EDIT",
      }),
    NO_CATEGORY,
  );
}

const TIERS = ["USER", "GROUP", "DEPARTMENT"] as const;

function fromField(row: { canView: boolean; canUpdate: boolean }): FieldAccess {
  return { canView: row.canView || row.canUpdate, canUpdate: row.canUpdate };
}

export function fieldAccess(ctx: AccessContext, fieldId: string, categoryId: string): FieldAccess {
  if (ctx.user.isAdmin) return { canView: true, canUpdate: true };
  const members = {
    USER: [ctx.user.id],
    GROUP: ctx.groupIds,
    DEPARTMENT: ctx.departmentIds,
  };
  for (const tier of TIERS) {
    const ids = members[tier];
    if (!ids.length) continue;
    const categoryRows = ctx.categoryPerms.filter(
      (row) => row.categoryId === categoryId && row.subjectType === tier && ids.includes(row.subjectId),
    );
    const fieldRows = ctx.fieldPerms.filter(
      (row) => row.fieldId === fieldId && row.subjectType === tier && ids.includes(row.subjectId),
    );
    const decides =
      fieldRows.length > 0 ||
      categoryRows.some((row) => row.applyToFields || row.grantLevel === "VIEW" || row.grantLevel === "EDIT");
    if (!decides) continue;
    const access = ids.reduce<FieldAccess>((current, subjectId) => {
      const category = categoryRows.find((row) => row.subjectId === subjectId);
      const field = fieldRows.find((row) => row.subjectId === subjectId);
      if (category && !category.applyToFields && (category.grantLevel === "VIEW" || category.grantLevel === "EDIT")) {
        return unionField(current, category.grantLevel === "EDIT" ? { canView: true, canUpdate: true } : { canView: true, canUpdate: false });
      }
      if (category?.applyToFields) return field ? unionField(current, fromField(field)) : current;
      return field ? unionField(current, fromField(field)) : current;
    }, { canView: false, canUpdate: false });
    if (access.canUpdate) access.canView = true;
    return access;
  }
  return { canView: false, canUpdate: false };
}

/** True when this person may read the value of an attribute: the same test the record form uses. */
export function canSeeValue(ctx: AccessContext, fieldId: string, categoryId: string) {
  if (ctx.user.isAdmin) return true;
  return categoryAccess(ctx, categoryId).canViewData && fieldAccess(ctx, fieldId, categoryId).canView;
}

/** Loads access for many users at once, sharing the permission tables between them. */
export async function loadAccessForUsers(userIds: string[]): Promise<Map<string, AccessContext>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  const result = new Map<string, AccessContext>();
  if (!unique.length) return result;
  const [users, categoryPerms, fieldPerms, modulePerms] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: unique }, isActive: true },
      include: { groups: { include: { group: true } } },
    }),
    prisma.categoryPermission.findMany(),
    prisma.fieldPermission.findMany(),
    prisma.modulePermission.findMany(),
  ]);
  for (const user of users) {
    const groupIds = user.groups.map((membership) => membership.groupId);
    const departmentIds = [
      ...new Set(user.groups.map((membership) => membership.group.departmentId).filter((id): id is string => Boolean(id))),
    ];
    result.set(user.id, { user, groupIds, departmentIds, categoryPerms, fieldPerms, modulePerms });
  }
  return result;
}

export function canManageStructure(user: { isAdmin: boolean; canDefineWorkflows: boolean }) {
  return user.isAdmin || user.canDefineWorkflows;
}
