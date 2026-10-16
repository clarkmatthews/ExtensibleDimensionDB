import { canEditModule, canSeeValue, canViewModule, fieldAccess, type AccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { listRecordTypes } from "@/lib/record-types";
import { creatableFieldIds, locationVisible } from "@/lib/row-scope";

/**
 * What a person can do with the records of one type.
 * - canView: they can see at least one of its attributes. Without that, the type, its list, and its
 *   records are hidden, so nobody opens a record that shows nothing.
 * - canAdd: they can create records of it, which needs edit access to Dimension and update access to
 *   at least one attribute. The same right archives and restores its records.
 * - canCreate: canAdd, and their scope lets a new record in. A scope that limits this type only
 *   allows new records through an attribute rule whose attribute they can update; a scope that
 *   only lists records never does.
 */
export type TypeRights = { canView: boolean; canAdd: boolean; canCreate: boolean };

const NONE: TypeRights = { canView: false, canAdd: false, canCreate: false };

export async function recordTypeRights(access: AccessContext): Promise<Map<string, TypeRights>> {
  const [types, fields] = await Promise.all([
    listRecordTypes(),
    prisma.fieldDefinition.findMany({
      where: { isActive: true, category: { isActive: true } },
      select: { id: true, categoryId: true, isCreatedDate: true, category: { select: { recordTypeId: true } } },
    }),
  ]);
  const viewer = canViewModule(access, "STORES");
  const editor = canEditModule(access, "STORES");
  const rights = new Map<string, TypeRights>();
  for (const type of types) {
    if (!viewer) {
      rights.set(type.id, NONE);
      continue;
    }
    if (access.user.isAdmin) {
      rights.set(type.id, { canView: true, canAdd: editor, canCreate: editor });
      continue;
    }
    const own = fields.filter((field) => field.category.recordTypeId === type.id && canSeeValue(access, field.id, field.categoryId));
    const canUpdate = (field: (typeof fields)[number]) => !field.isCreatedDate && fieldAccess(access, field.id, field.categoryId).canUpdate;
    const canAdd = editor && own.some(canUpdate);
    const ruleFields = creatableFieldIds(access, type.id);
    const canCreate = canAdd && (ruleFields === null || own.some((field) => ruleFields.includes(field.id) && canUpdate(field)));
    rights.set(type.id, { canView: own.length > 0, canAdd, canCreate });
  }
  return rights;
}

/** One record type's rights. Unknown or inactive types have none. */
export async function rightsForType(access: AccessContext, recordTypeId: string) {
  return (await recordTypeRights(access)).get(recordTypeId) ?? NONE;
}

/** The record types this person can view, and the requested one when it is among them (otherwise the first). */
export async function resolveVisibleRecordType(access: AccessContext, requested?: string | null) {
  const [all, rights] = await Promise.all([listRecordTypes(), recordTypeRights(access)]);
  const types = all.filter((type) => rights.get(type.id)?.canView);
  const current = types.find((type) => type.id === requested) ?? types[0] ?? null;
  return { all, types, current, rights: (current && rights.get(current.id)) || NONE, rightsByType: rights };
}

/** Rights for one record, or null when it does not exist or is outside this person's scope. */
export async function rightsForRecord(access: AccessContext, locationId: string) {
  const location = await prisma.location.findUnique({ where: { id: locationId }, select: { recordTypeId: true } });
  if (!location || !(await locationVisible(access, locationId))) return null;
  return rightsForType(access, location.recordTypeId);
}
