import type { CategoryPermission, FieldPermission, GrantLevel, ModulePermission, SubjectType, User } from "@prisma/client";
import { NAV_MODULES, type NavModuleId } from "@/lib/nav-modules";
import { prisma } from "@/lib/prisma";
import { loadRowScope, type RowScopeData } from "@/lib/row-scope";

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

function unionField(left: FieldAccess, right: FieldAccess): FieldAccess {
  return {
    canView: left.canView || right.canView,
    canUpdate: left.canUpdate || right.canUpdate,
  };
}

export type AccessUser = User & {
  groups: { groupId: string }[];
};

export type AccessContext = {
  user: AccessUser;
  groupIds: string[];
  categoryPerms: CategoryPermission[];
  fieldPerms: FieldPermission[];
  modulePerms: ModulePermission[];
  /** Row rules for this request. Missing means no scopes exist, so every row is visible. */
  rowScope?: RowScopeData;
};

/**
 * Who a grant can come from, strongest first. A person's own settings override one item at a time;
 * whatever they leave unset comes from their groups combined.
 */
export type Tier = { subjectType: SubjectType; ids: string[] };

export function tiersFor(ctx: Pick<AccessContext, "user" | "groupIds">): Tier[] {
  return [
    { subjectType: "USER", ids: [ctx.user.id] },
    { subjectType: "GROUP", ids: ctx.groupIds },
  ];
}

/** Only the person's groups: what they would have without settings of their own. */
export function groupTiersFor(ctx: Pick<AccessContext, "groupIds">): Tier[] {
  return [{ subjectType: "GROUP", ids: ctx.groupIds }];
}

export async function loadAccess(user: AccessUser): Promise<AccessContext> {
  const groupIds = user.groups.map((membership) => membership.groupId);
  const [categoryPerms, fieldPerms, modulePerms, rowScope] = await Promise.all([
    prisma.categoryPermission.findMany(),
    prisma.fieldPermission.findMany(),
    prisma.modulePermission.findMany(),
    loadRowScope(),
  ]);
  return { user, groupIds, categoryPerms, fieldPerms, modulePerms, rowScope };
}

function strongestLevel(rows: { grantLevel: GrantLevel }[]): GrantLevel {
  if (rows.some((row) => row.grantLevel === "EDIT")) return "EDIT";
  if (rows.some((row) => row.grantLevel === "VIEW")) return "VIEW";
  return "NONE";
}

function inTier<T extends { subjectType: string; subjectId: string }>(rows: T[], tier: Tier) {
  return rows.filter((row) => row.subjectType === tier.subjectType && tier.ids.includes(row.subjectId));
}

/** Screen access from the first tier that has a setting for this screen. */
export function moduleAccessIn(tiers: Tier[], modulePerms: ModulePermission[], moduleId: NavModuleId): GrantLevel {
  const rows = modulePerms.filter((row) => row.module === moduleId);
  for (const tier of tiers) {
    const decided = inTier(rows, tier);
    if (decided.length) return strongestLevel(decided);
  }
  return "NONE";
}

export function moduleAccess(ctx: AccessContext, moduleId: NavModuleId): GrantLevel {
  if (ctx.user.isAdmin) return "EDIT";
  return moduleAccessIn(tiersFor(ctx), ctx.modulePerms, moduleId);
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

export const STRUCTURE_RIGHTS = ["canAddFields", "canRemoveFields", "canEditFields", "canEditCategory", "canAssignPermissions"] as const;
export type StructureRight = (typeof STRUCTURE_RIGHTS)[number];

const shows = (level: GrantLevel | null | undefined) => level === "VIEW" || level === "EDIT";

/**
 * A person's own tier overrides one item at a time: an empty right or level follows the tiers below.
 * A group tier combines its groups, and decides once any of its groups has a grant for the dimension.
 */
export function categoryAccessIn(tiers: Tier[], categoryPerms: CategoryPermission[], categoryId: string): CategoryAccess {
  const rows = categoryPerms.filter((row) => row.categoryId === categoryId);
  const result = { ...NO_CATEGORY };
  for (const right of STRUCTURE_RIGHTS) {
    for (const tier of tiers) {
      const decided = inTier(rows, tier);
      if (tier.subjectType === "USER") {
        const values = decided.map((row) => row[right]).filter((value): value is boolean => value !== null);
        if (!values.length) continue;
        result[right] = values.some(Boolean);
        break;
      }
      if (!decided.length) continue;
      result[right] = decided.some((row) => row[right] === true);
      break;
    }
  }
  for (const tier of tiers) {
    const decided = inTier(rows, tier);
    if (tier.subjectType === "USER") {
      const own = decided.filter((row) => row.applyToFields || row.grantLevel !== null);
      if (!own.length) continue;
      // Specific attributes: each attribute decides whether its value shows.
      result.canViewData = own.some((row) => row.applyToFields || shows(row.grantLevel));
      break;
    }
    if (!decided.length) continue;
    result.canViewData = decided.some((row) => row.canViewData || shows(row.grantLevel));
    break;
  }
  return result;
}

export function categoryAccess(ctx: AccessContext, categoryId: string): CategoryAccess {
  if (ctx.user.isAdmin) return ALL_CATEGORY;
  return categoryAccessIn(tiersFor(ctx), ctx.categoryPerms, categoryId);
}

function fromField(row: { canView: boolean; canUpdate: boolean }): FieldAccess {
  return { canView: row.canView || row.canUpdate, canUpdate: row.canUpdate };
}

function fromLevel(level: GrantLevel | null): FieldAccess {
  return { canView: shows(level), canUpdate: level === "EDIT" };
}

export function fieldAccessIn(
  tiers: Tier[],
  categoryPerms: CategoryPermission[],
  fieldPerms: FieldPermission[],
  fieldId: string,
  categoryId: string,
): FieldAccess {
  for (const tier of tiers) {
    if (!tier.ids.length) continue;
    const categoryRows = inTier(categoryPerms.filter((row) => row.categoryId === categoryId), tier);
    const fieldRows = inTier(fieldPerms.filter((row) => row.fieldId === fieldId), tier);
    if (tier.subjectType === "USER") {
      // A person's own level for the entire dimension, then their own level for this attribute.
      const whole = categoryRows.find((row) => !row.applyToFields && row.grantLevel !== null);
      if (whole) return fromLevel(whole.grantLevel);
      if (fieldRows.length) return fieldRows.map(fromField).reduce(unionField);
      continue;
    }
    const decides = fieldRows.length > 0 || categoryRows.some((row) => row.applyToFields || shows(row.grantLevel));
    if (!decides) continue;
    const access = tier.ids.reduce<FieldAccess>((current, subjectId) => {
      const category = categoryRows.find((row) => row.subjectId === subjectId);
      const field = fieldRows.find((row) => row.subjectId === subjectId);
      if (category && !category.applyToFields && shows(category.grantLevel)) return unionField(current, fromLevel(category.grantLevel));
      return field ? unionField(current, fromField(field)) : current;
    }, { canView: false, canUpdate: false });
    if (access.canUpdate) access.canView = true;
    return access;
  }
  return { canView: false, canUpdate: false };
}

export function fieldAccess(ctx: AccessContext, fieldId: string, categoryId: string): FieldAccess {
  if (ctx.user.isAdmin) return { canView: true, canUpdate: true };
  return fieldAccessIn(tiersFor(ctx), ctx.categoryPerms, ctx.fieldPerms, fieldId, categoryId);
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
  const [users, categoryPerms, fieldPerms, modulePerms, rowScope] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: unique }, isActive: true },
      include: { groups: true },
    }),
    prisma.categoryPermission.findMany(),
    prisma.fieldPermission.findMany(),
    prisma.modulePermission.findMany(),
    loadRowScope(),
  ]);
  for (const user of users) {
    const groupIds = user.groups.map((membership) => membership.groupId);
    result.set(user.id, { user, groupIds, categoryPerms, fieldPerms, modulePerms, rowScope });
  }
  return result;
}

export function canManageStructure(user: { isAdmin: boolean; canDefineWorkflows: boolean }) {
  return user.isAdmin || user.canDefineWorkflows;
}
