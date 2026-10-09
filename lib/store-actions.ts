"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditModule, categoryAccess, fieldAccess, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { validateValue } from "@/lib/validators";
import { defaultInput, displayRaw, displayStored, inputToStored, localDateInput, rulesFromField, type DefinedField } from "@/lib/values";
import { choicesForParent } from "@/lib/list-correlation";
import { choicesForList } from "@/lib/list-items";
import { runWorkflows, startManualProcess, type SavedChange } from "@/lib/workflow";

class IdentifierTakenError extends Error {
  constructor(readonly attribute: string) {
    super(`${attribute} must be unique.`);
  }
}

type ValueReader = Pick<Prisma.TransactionClient, "fieldValue">;

async function identifierTaken(db: ValueReader, fieldId: string, value: string, locationId: string) {
  const clash = await db.fieldValue.findFirst({
    where: { fieldId, valueText: value, ...(locationId ? { locationId: { not: locationId } } : {}) },
    select: { id: true },
  });
  return Boolean(clash);
}

async function actor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return { user, access: await loadAccess(user) };
}

export async function saveStore(formData: FormData) {
  const { user, access } = await actor();
  if (!canEditModule(access, "STORES")) return { error: "You cannot change dimensions." };
  const locationId = String(formData.get("locationId") ?? "");
  const fields = await prisma.fieldDefinition.findMany({
    where: { isActive: true, category: { isActive: true } },
    include: { options: { orderBy: { sortOrder: "asc" } }, category: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });

  const storedText = new Map(
    (locationId ? await prisma.fieldValue.findMany({ where: { locationId } }) : []).map((value) => [value.fieldId, value.valueText ?? ""]),
  );
  const rawOf = (fieldId: string, multiple: boolean) => {
    const name = `field:${fieldId}`;
    if (!formData.has(name)) return storedText.get(fieldId) ?? "";
    const submitted = formData.getAll(name).map(String).filter(Boolean);
    return multiple ? submitted.join("|") : (submitted[0] ?? "");
  };

  const errors: string[] = [];
  const writes: { field: DefinedField; raw: string; options?: { label: string; value: string }[] }[] = [];
  const listIds = [...new Set(fields.map((field) => field.choiceListId).filter((id): id is string => Boolean(id)))];
  const listRows = listIds.length
    ? await prisma.choiceList.findMany({ where: { id: { in: listIds } }, select: { id: true, parentListId: true } })
    : [];
  const listById = new Map(listRows.map((list) => [list.id, list]));
  const optionCache = new Map<string, { label: string; value: string }[]>();
  for (const field of fields) {
    if (field.isCreatedDate) continue;
    const categoryRights = categoryAccess(access, field.categoryId);
    const fieldRights = fieldAccess(access, field.id, field.categoryId);
    if (!categoryRights.canViewData || !fieldRights.canView) continue;
    if (!fieldRights.canUpdate) continue;
    const submitted = formData.getAll(`field:${field.id}`).map(String);
    const raw = field.multiple ? submitted.filter(Boolean).join("|") : (submitted[0] ?? "");
    const rules = rulesFromField(field);
    const parent = field.parentFieldId ? fields.find((item) => item.id === field.parentFieldId) : undefined;
    const parentRaw = parent ? rawOf(parent.id, parent.multiple) : "";
    const list = field.choiceListId ? listById.get(field.choiceListId) : undefined;
    if (list?.parentListId) rules.options = await choicesForList(list.id, parentRaw);
    else if (list) {
      const cached = optionCache.get(list.id);
      rules.options = cached ?? (await choicesForList(list.id, null));
      if (!cached) optionCache.set(list.id, rules.options);
    } else if (parent && (field.dataType === "DROPDOWN" || field.dataType === "RADIO")) {
      rules.options = choicesForParent(field.options, parentRaw, true);
    }
    const error = await validateValue(rules, raw);
    if (error) errors.push(`${field.friendlyName}: ${error}`);
    writes.push({ field, raw, options: rules.options });
  }
  if (errors.length) return { error: errors[0] };

  const keyWrites = writes.filter((write) => write.field.isStoreKey && write.raw.trim());
  for (const write of keyWrites) {
    if (await identifierTaken(prisma, write.field.id, write.raw.trim(), locationId)) {
      return { error: `${write.field.friendlyName} must be unique.` };
    }
  }

  if (!locationId) {
    for (const field of fields) {
      if (field.isCreatedDate) continue;
      const categoryRights = categoryAccess(access, field.categoryId);
      const fieldRights = fieldAccess(access, field.id, field.categoryId);
      if (!categoryRights.canViewData || !fieldRights.canUpdate) continue;
      if (writes.some((write) => write.field.id === field.id)) continue;
      const fallback = defaultInput(field);
      if (fallback) writes.push({ field, raw: fallback });
    }
  }

  // Everything below is one transaction: the record, its values, and its changelog rows
  // are saved together or not at all. Unique identifiers are re-checked under a lock so
  // two people saving at the same moment cannot both claim the same identifier.
  let saved: { locationId: string; changes: SavedChange[] };
  try {
    saved = await prisma.$transaction(async (tx) => {
      for (const write of keyWrites) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identifier:${write.field.id}`}))`;
        if (await identifierTaken(tx, write.field.id, write.raw.trim(), locationId)) {
          throw new IdentifierTakenError(write.field.friendlyName);
        }
      }
      const previousValues = locationId ? await tx.fieldValue.findMany({ where: { locationId } }) : [];
      const location = locationId
        ? await tx.location.update({ where: { id: locationId }, data: { updatedAt: new Date() } })
        : await tx.location.create({ data: {} });
      const pending = [...writes];
      for (const createdField of fields.filter((field) => field.isCreatedDate && field.dataType === "DATE")) {
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
          data: { locationId: location.id, fieldId: write.field.id, userId: user.id, oldValue, newValue },
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
      return { locationId: location.id, changes };
    });
  } catch (error) {
    if (error instanceof IdentifierTakenError) return { error: `${error.attribute} must be unique.` };
    throw error;
  }
  const location = { id: saved.locationId };
  const changes = saved.changes;

  await runWorkflows({
    locationId: location.id,
    userId: user.id,
    userName: user.name,
    created: !locationId,
    changes,
  });
  revalidatePath("/dimensions");
  revalidatePath("/dashboard");
  revalidatePath("/changelog");
  redirect(`/dimensions/${location.id}`);
}

export async function startWorkflow(formData: FormData) {
  const { user, access } = await actor();
  if (!canEditModule(access, "STORES")) redirect("/dimensions?error=You%20cannot%20change%20dimensions.");
  const locationId = String(formData.get("locationId") ?? "");
  const processId = String(formData.get("processId") ?? "");
  const error = await startManualProcess(locationId, processId, user.id);
  revalidatePath("/dashboard");
  revalidatePath(`/dimensions/${locationId}`);
  redirect(error ? `/dimensions/${locationId}?error=${encodeURIComponent(error)}` : `/dimensions/${locationId}`);
}

export async function taskAction(formData: FormData) {
  const { user, access } = await actor();
  if (!canEditModule(access, "INBOX")) redirect("/dashboard?error=You%20cannot%20change%20actions.");
  const { applyTaskAction } = await import("@/lib/workflow");
  const error = await applyTaskAction({
    taskId: String(formData.get("taskId") ?? ""),
    userId: user.id,
    action: String(formData.get("action") ?? ""),
    comment: String(formData.get("comment") ?? ""),
    keepWatching: formData.get("keepWatching") === "on",
    assigneeUserId: String(formData.get("assigneeUserId") ?? "") || undefined,
    postponeDays: Number(formData.get("postponeDays") ?? "") || undefined,
    nextDeadlineDays: Number(formData.get("nextDeadlineDays") ?? "") || undefined,
  });
  revalidatePath("/dashboard");
  revalidatePath("/reports/tasks");
  const returnTo = String(formData.get("returnTo") ?? "");
  const dest = returnTo.startsWith("/reports/tasks") || returnTo.startsWith("/dashboard") ? returnTo.split("?")[0] : "/dashboard";
  redirect(error ? `${dest}?error=${encodeURIComponent(error)}` : dest);
}
