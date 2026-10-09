import type { Prisma } from "@prisma/client";
import { choicesForParent } from "@/lib/list-correlation";
import { choicesForList } from "@/lib/list-items";
import { categoryAccess, fieldAccess, type AccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withLinkOptions } from "@/lib/record-types";
import { validateValue, type Choice } from "@/lib/validators";
import { defaultInput, displayRaw, displayStored, inputToStored, localDateInput, rulesFromField, type DefinedField } from "@/lib/values";
import type { SavedChange } from "@/lib/workflow";

/**
 * The one place records are written. The record form, CSV import, and (later) AI proposals
 * all go through saveRecord, so validation, permissions, uniqueness, and the changelog
 * behave the same everywhere.
 */

export type LoadedField = DefinedField & { category: { id: string; name: string } };

/** Values for one save. `undefined` means the attribute was not supplied and keeps its value. */
export type RecordInput = (field: LoadedField) => string | undefined;

/**
 * The value of a parent attribute, used to decide which child choices are allowed.
 * `undefined` falls back to the stored value. Defaults to the record input itself.
 */
export type ParentInput = (field: LoadedField) => string | undefined;

export type SaveContext = {
  recordTypeId: string;
  fields: LoadedField[];
  listById: Map<string, { id: string; parentListId: string | null }>;
  optionCache: Map<string, Choice[]>;
};

export type PlannedWrite = { field: LoadedField; raw: string; options?: Choice[] };

export type SavePlan =
  | { ok: false; error: string; errors: string[] }
  | { ok: true; writes: PlannedWrite[]; keyWrites: PlannedWrite[] };

class IdentifierTakenError extends Error {
  constructor(readonly attribute: string) {
    super(`${attribute} must be unique.`);
  }
}

type ValueReader = Pick<Prisma.TransactionClient, "fieldValue">;

export async function identifierTaken(db: ValueReader, fieldId: string, value: string, locationId: string) {
  const clash = await db.fieldValue.findFirst({
    // Archived records do not hold their identifier; restoring checks for a clash instead.
    where: { fieldId, valueText: value, location: { isActive: true }, ...(locationId ? { locationId: { not: locationId } } : {}) },
    select: { id: true },
  });
  return Boolean(clash);
}

/**
 * Loads one record type's active attributes and list metadata once, so a batch of saves
 * can share them. Link attributes get the target records as their options.
 */
export async function loadSaveContext(recordTypeId: string): Promise<SaveContext> {
  const fields = await withLinkOptions(
    await prisma.fieldDefinition.findMany({
      where: { isActive: true, category: { isActive: true, recordTypeId } },
      include: { options: { orderBy: { sortOrder: "asc" } }, category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
  );
  const listIds = [...new Set(fields.map((field) => field.choiceListId).filter((id): id is string => Boolean(id)))];
  const listRows = listIds.length
    ? await prisma.choiceList.findMany({ where: { id: { in: listIds } }, select: { id: true, parentListId: true } })
    : [];
  return { recordTypeId, fields, listById: new Map(listRows.map((list) => [list.id, list])), optionCache: new Map() };
}

/** True when this person may change this attribute on records. */
export function canUpdateField(access: AccessContext, field: LoadedField) {
  if (field.isCreatedDate) return false;
  const categoryRights = categoryAccess(access, field.categoryId);
  const fieldRights = fieldAccess(access, field.id, field.categoryId);
  return categoryRights.canViewData && fieldRights.canView && fieldRights.canUpdate;
}

/** The choices an attribute allows, given the value of the attribute it follows. */
export async function choicesFor(ctx: SaveContext, field: LoadedField, parentRaw: string): Promise<Choice[]> {
  if (field.dataType === "RECORD_LINK") return field.options.map((option) => ({ label: option.label, value: option.value }));
  const parent = field.parentFieldId ? ctx.fields.find((item) => item.id === field.parentFieldId) : undefined;
  const list = field.choiceListId ? ctx.listById.get(field.choiceListId) : undefined;
  if (list?.parentListId) return choicesForList(list.id, parentRaw);
  if (list) {
    const cached = ctx.optionCache.get(list.id);
    if (cached) return cached;
    const loaded = await choicesForList(list.id, null);
    ctx.optionCache.set(list.id, loaded);
    return loaded;
  }
  if (parent && (field.dataType === "DROPDOWN" || field.dataType === "RADIO")) {
    return choicesForParent(field.options, parentRaw, true);
  }
  return rulesFromField(field).options;
}

/**
 * Validates a save without writing anything. Used by the form, and by CSV import to preview
 * every row before anything is applied.
 */
export async function planSave(
  ctx: SaveContext,
  access: AccessContext,
  locationId: string,
  input: RecordInput,
  stored: Map<string, string>,
  parentInput: ParentInput = input,
): Promise<SavePlan> {
  const rawOf = (field: LoadedField) => parentInput(field) ?? stored.get(field.id) ?? "";
  const errors: string[] = [];
  const writes: PlannedWrite[] = [];
  for (const field of ctx.fields) {
    if (!canUpdateField(access, field)) continue;
    const raw = input(field);
    if (raw === undefined) {
      // Not supplied. A new record still has to satisfy required attributes and defaults below.
      if (!locationId && field.isRequired && !defaultInput(field)) errors.push(`${field.friendlyName}: This attribute is required.`);
      continue;
    }
    const rules = rulesFromField(field);
    const parent = field.parentFieldId ? ctx.fields.find((item) => item.id === field.parentFieldId) : undefined;
    rules.options = await choicesFor(ctx, field, parent ? rawOf(parent) : "");
    if (field.dataType === "RECORD_LINK") {
      // A link to a record that was archived since stays valid, so the rest of this record can still be edited.
      const known = new Set(rules.options.map((option) => option.value));
      for (const id of (stored.get(field.id) ?? "").split("|").filter(Boolean)) {
        if (!known.has(id)) rules.options.push({ label: id, value: id });
      }
    }
    const error = await validateValue(rules, raw);
    if (error) errors.push(`${field.friendlyName}: ${error}`);
    writes.push({ field, raw, options: rules.options });
  }
  if (errors.length) return { ok: false, error: errors[0], errors };

  if (!locationId) {
    for (const field of ctx.fields) {
      if (!canUpdateField(access, field)) continue;
      if (writes.some((write) => write.field.id === field.id)) continue;
      const fallback = defaultInput(field);
      if (fallback) writes.push({ field, raw: fallback });
    }
  }
  const keyWrites = writes.filter((write) => write.field.isStoreKey && write.raw.trim());
  for (const write of keyWrites) {
    if (await identifierTaken(prisma, write.field.id, write.raw.trim(), locationId)) {
      const message = `${write.field.friendlyName} must be unique.`;
      return { ok: false, error: message, errors: [message] };
    }
  }
  return { ok: true, writes, keyWrites };
}

/** Current stored values of a record, as form input text, for planSave. */
export async function storedInputs(locationId: string) {
  if (!locationId) return new Map<string, string>();
  const rows = await prisma.fieldValue.findMany({ where: { locationId } });
  return new Map(rows.map((value) => [value.fieldId, value.valueText ?? ""]));
}

export type SaveResult = { error: string } | { error?: undefined; locationId: string; created: boolean; changes: SavedChange[] };

/**
 * Validates and writes one record in a single transaction: values and changelog rows are
 * saved together or not at all, and unique identifiers are re-checked under a lock.
 * Does not run workflows or webhooks; call afterRecordSaved for that.
 */
export async function saveRecord(input: {
  ctx: SaveContext;
  access: AccessContext;
  userId: string;
  locationId: string;
  values: RecordInput;
  parentValues?: ParentInput;
  /** Set when an approved AI proposal is being applied, for the changelog. */
  proposalId?: string;
}): Promise<SaveResult> {
  const { ctx, access, userId, locationId } = input;
  if (locationId) {
    const existing = await prisma.location.findUnique({ where: { id: locationId }, select: { isActive: true, recordTypeId: true } });
    if (!existing) return { error: "This record no longer exists." };
    if (existing.recordTypeId !== ctx.recordTypeId) return { error: "This record belongs to a different record type." };
    if (!existing.isActive) return { error: "This record is archived. Restore it before editing." };
  }
  const plan = await planSave(ctx, access, locationId, input.values, await storedInputs(locationId), input.parentValues ?? input.values);
  if (!plan.ok) return { error: plan.error };

  try {
    return await prisma.$transaction(async (tx) => {
      for (const write of plan.keyWrites) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identifier:${write.field.id}`}))`;
        if (await identifierTaken(tx, write.field.id, write.raw.trim(), locationId)) {
          throw new IdentifierTakenError(write.field.friendlyName);
        }
      }
      const previousValues = locationId ? await tx.fieldValue.findMany({ where: { locationId } }) : [];
      const location = locationId
        ? await tx.location.update({ where: { id: locationId }, data: { updatedAt: new Date() } })
        : await tx.location.create({ data: { recordTypeId: ctx.recordTypeId } });
      const pending = [...plan.writes];
      for (const createdField of ctx.fields.filter((field) => field.isCreatedDate && field.dataType === "DATE")) {
        const existingCreated = await tx.fieldValue.findUnique({
          where: { locationId_fieldId: { locationId: location.id, fieldId: createdField.id } },
        });
        if (!existingCreated) pending.push({ field: createdField, raw: localDateInput(location.createdAt) });
      }
      const changes: SavedChange[] = [];
      for (const write of pending) {
        const previous = previousValues.find((value) => value.fieldId === write.field.id);
        const oldValue = displayStored(write.field, previous, write.options);
        const newValue = displayRaw(write.field, write.raw, write.options);
        const stored = inputToStored(write.field, write.raw);
        await tx.fieldValue.upsert({
          where: { locationId_fieldId: { locationId: location.id, fieldId: write.field.id } },
          update: stored,
          create: { locationId: location.id, fieldId: write.field.id, ...stored },
        });
        if (oldValue === newValue) continue;
        const row = await tx.fieldChange.create({
          data: { locationId: location.id, fieldId: write.field.id, userId, oldValue, newValue, proposalId: input.proposalId ?? null },
        });
        changes.push({
          id: row.id,
          fieldId: write.field.id,
          categoryId: write.field.categoryId,
          attribute: write.field.friendlyName,
          oldValue,
          newValue,
        });
      }
      return { locationId: location.id, created: !locationId, changes };
    });
  } catch (error) {
    if (error instanceof IdentifierTakenError) return { error: `${error.attribute} must be unique.` };
    throw error;
  }
}
