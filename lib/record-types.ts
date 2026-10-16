import type { FieldOption } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allowedIds, filterVisibleIds, type ScopeAccess } from "@/lib/row-scope";

/** Active record types in display order. */
export async function listRecordTypes() {
  return prisma.recordType.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

/** The requested type when it exists and is active, otherwise the first active type. */
export async function resolveRecordType(requested?: string | null) {
  const types = await listRecordTypes();
  return { types, current: types.find((type) => type.id === requested) ?? types[0] ?? null };
}

/**
 * Labels for records: the value of each record's unique identifier, or the record id when
 * its type has no identifier yet. Works across record types.
 */
export async function recordLabels(locationIds: string[]) {
  const ids = [...new Set(locationIds)].filter(Boolean);
  if (!ids.length) return new Map<string, string>();
  const rows = await prisma.fieldValue.findMany({
    where: { locationId: { in: ids }, field: { isStoreKey: true } },
    select: { locationId: true, valueText: true },
  });
  const labels = new Map(rows.map((row) => [row.locationId, row.valueText || row.locationId]));
  for (const id of ids) if (!labels.has(id)) labels.set(id, id);
  return labels;
}

/** The choices for a link attribute: active records of the target type this person may see, by label. */
export async function linkChoices(linkTypeId: string, access?: ScopeAccess) {
  const allowed = access ? await allowedIds(access, linkTypeId) : null;
  const records = await prisma.location.findMany({
    where: { recordTypeId: linkTypeId, isActive: true, ...(allowed ? { id: { in: allowed } } : {}) },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const labels = await recordLabels(records.map((record) => record.id));
  return records
    .map((record) => ({ value: record.id, label: labels.get(record.id) ?? record.id }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base", numeric: true }));
}

type WithOptions = { id: string; dataType: string; linkTypeId: string | null; options: FieldOption[] };

/**
 * Gives link attributes their choices in `options`, the same place list attributes keep
 * theirs, so display, validation, export, and AI knowledge show record labels, not ids.
 */
export async function withLinkOptions<T extends WithOptions>(fields: T[], access?: ScopeAccess): Promise<T[]> {
  const targets = [...new Set(fields.filter((field) => field.dataType === "RECORD_LINK" && field.linkTypeId).map((field) => field.linkTypeId!))];
  if (!targets.length) return fields;
  const choices = new Map(await Promise.all(targets.map(async (typeId) => [typeId, await linkChoices(typeId, access)] as const)));
  return fields.map((field) => {
    if (field.dataType !== "RECORD_LINK" || !field.linkTypeId) return field;
    const options: FieldOption[] = (choices.get(field.linkTypeId) ?? []).map((choice, index) => ({
      id: `link-${choice.value}`,
      fieldId: field.id,
      label: choice.label,
      value: choice.value,
      parentValues: "",
      isDefault: false,
      sortOrder: index,
    }));
    return { ...field, options };
  });
}

/** Records that link to this one, grouped by the link attribute. Hidden rows are left out when access is set. */
export async function linkedFrom(locationId: string, access?: ScopeAccess) {
  const values = await prisma.fieldValue.findMany({
    where: {
      field: { dataType: "RECORD_LINK", isActive: true },
      location: { isActive: true },
      OR: [
        { valueText: locationId },
        { valueText: { startsWith: `${locationId}|` } },
        { valueText: { endsWith: `|${locationId}` } },
        { valueText: { contains: `|${locationId}|` } },
      ],
    },
    include: { field: { include: { category: { include: { recordType: true } } } } },
  });
  const visible = access ? await filterVisibleIds(access, values.map((value) => value.locationId)) : null;
  const shown = visible ? values.filter((value) => visible.has(value.locationId)) : values;
  const labels = await recordLabels(shown.map((value) => value.locationId));
  return shown.map((value) => ({
    locationId: value.locationId,
    label: labels.get(value.locationId) ?? value.locationId,
    fieldId: value.fieldId,
    categoryId: value.field.categoryId,
    attribute: value.field.friendlyName,
    recordType: value.field.category.recordType.name,
  }));
}
