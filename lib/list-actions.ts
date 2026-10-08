"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ChoiceSource, Prisma } from "@prisma/client";
import { deleteChoiceList, previewChoiceItem, previewChoiceList, purgeListValue } from "@/lib/cascade-delete";
import { prisma } from "@/lib/prisma";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

type ListItemInput = {
  id?: string;
  label: string;
  value: string;
  isDefault?: boolean;
  parentValues?: string;
  isActive?: boolean;
};

async function editor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canEditModule(access, "LISTS")) redirect("/admin/lists?error=You%20cannot%20change%20lists.");
  return user;
}

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function parentError(listId: string, parentId: string) {
  if (listId && listId === parentId) return "A list cannot follow itself.";
  const parent = await prisma.choiceList.findUnique({ where: { id: parentId }, select: { id: true, parentListId: true } });
  if (!parent) return "Choose a list to follow.";
  let cursor: string | null = parent.parentListId;
  const seen = new Set<string>([parentId]);
  while (cursor) {
    if (cursor === listId) return "That correlation loops back to this list.";
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const next: { parentListId: string | null } | null = await prisma.choiceList.findUnique({
      where: { id: cursor },
      select: { parentListId: true },
    });
    cursor = next?.parentListId ?? null;
  }
  return null;
}

function cleanItems(items: ListItemInput[]) {
  return items
    .map((item) => ({
      id: item.id?.trim() || "",
      label: item.label.trim(),
      value: (item.value || item.label).trim(),
      parentValues: (item.parentValues ?? "").split("|").map((value) => value.trim()).filter(Boolean).join("|"),
      isDefault: Boolean(item.isDefault),
      isActive: item.isActive !== false,
    }))
    .filter((item) => item.label && item.value);
}

async function renameStoredValues(tx: Prisma.TransactionClient, listId: string, from: string, to: string) {
  if (!from || from === to) return;
  await tx.fieldValue.updateMany({
    where: { field: { choiceListId: listId }, valueText: from },
    data: { valueText: to },
  });
  const rows = await tx.fieldValue.findMany({
    where: { field: { choiceListId: listId }, valueText: { contains: from, not: from } },
    select: { id: true, valueText: true },
  });
  for (const row of rows) {
    const tokens = (row.valueText ?? "").split("|").map((value) => value.trim()).filter(Boolean);
    if (!tokens.includes(from)) continue;
    await tx.fieldValue.update({
      where: { id: row.id },
      data: { valueText: tokens.map((token) => (token === from ? to : token)).join("|") },
    });
  }
}

async function remapChildValues(tx: Prisma.TransactionClient, listId: string, from: string, to: string | null) {
  const children = await tx.choiceList.findMany({ where: { parentListId: listId }, select: { id: true } });
  const childIds = children.map((child) => child.id);
  if (!childIds.length || !from) return;
  if (to) {
    await tx.choiceListItem.updateMany({ where: { listId: { in: childIds }, parentValues: from }, data: { parentValues: to } });
  } else {
    await tx.choiceListItem.deleteMany({ where: { listId: { in: childIds }, parentValues: from } });
  }
  const rows = await tx.choiceListItem.findMany({
    where: { listId: { in: childIds }, parentValues: { contains: from, not: from } },
    select: { id: true, parentValues: true },
  });
  for (const row of rows) {
    const tokens = row.parentValues.split("|").map((value) => value.trim()).filter(Boolean);
    if (!tokens.includes(from)) continue;
    const next = tokens.flatMap((token) => (token === from ? (to ? [to] : []) : [token]));
    if (!next.length) await tx.choiceListItem.delete({ where: { id: row.id } });
    else await tx.choiceListItem.update({ where: { id: row.id }, data: { parentValues: next.join("|") } });
  }
}

async function syncFields(tx: Prisma.TransactionClient, listId: string) {
  const list = await tx.choiceList.findUnique({ where: { id: listId }, select: { choiceSource: true } });
  if (!list) return;
  const items =
    list.choiceSource === "MANUAL"
      ? await tx.choiceListItem.findMany({
          where: { listId, isActive: true, list: { parentListId: null } },
          orderBy: { sortOrder: "asc" },
        })
      : [];
  const fields = await tx.fieldDefinition.findMany({ where: { choiceListId: listId }, select: { id: true } });
  for (const field of fields) {
    await tx.fieldDefinition.update({ where: { id: field.id }, data: { choiceSource: list.choiceSource } });
    await tx.fieldOption.deleteMany({ where: { fieldId: field.id } });
    if (list.choiceSource === "MANUAL" && items.length) {
      await tx.fieldOption.createMany({
        data: items.map((item, index) => ({
          fieldId: field.id,
          label: item.label,
          value: item.value,
          parentValues: item.parentValues,
          isDefault: item.isDefault,
          sortOrder: index,
        })),
      });
    }
  }
}

function refresh() {
  revalidatePath("/admin/lists");
  revalidatePath("/admin/definition");
  revalidatePath("/dimensions");
}

export async function createList(formData: FormData) {
  await editor();
  const name = text(formData, "name");
  const description = text(formData, "description");
  const parentListId = text(formData, "parentListId");
  if (!name) redirect("/admin/lists?error=List%20name%20is%20required.");
  if (parentListId) {
    const error = await parentError("", parentListId);
    if (error) redirect(`/admin/lists?error=${encodeURIComponent(error)}`);
  }
  const list = await prisma.choiceList.create({
    data: { name, description, parentListId: parentListId || null },
  });
  refresh();
  redirect(`/admin/lists?open=${list.id}`);
}

export async function setListActive(formData: FormData) {
  await editor();
  const id = text(formData, "id");
  const active = text(formData, "active") === "1";
  await prisma.choiceList.update({ where: { id }, data: { isActive: active } });
  refresh();
}

export async function saveListContents(formData: FormData) {
  await editor();
  const id = text(formData, "id");
  const name = text(formData, "name");
  const description = text(formData, "description");
  const parentListId = text(formData, "parentListId");
  const list = await prisma.choiceList.findUnique({ where: { id }, include: { fields: { select: { dataType: true } } } });
  if (!list) return { error: "This list was not found." };
  if (!name) return { error: "List name is required." };
  if (parentListId) {
    const error = await parentError(id, parentListId);
    if (error) return { error };
  }

  const items = cleanItems(JSON.parse(text(formData, "items") || "[]") as ListItemInput[]);
  const keepItems = items.length === 0 && Boolean(list.parentListId || parentListId);
  const activeCount = items.filter((item) => item.isActive).length;
  if (!keepItems && activeCount < 1) return { error: "Add at least one active list item." };
  if (!keepItems && list.fields.some((field) => field.dataType === "RADIO") && (activeCount < 2 || activeCount > 5)) {
    return { error: "A list used by a radio attribute needs between 2 and 5 active items." };
  }

  await prisma.$transaction(async (tx) => {
    const previous = keepItems ? [] : await tx.choiceListItem.findMany({ where: { listId: id }, select: { id: true, value: true } });
    await tx.choiceList.update({
      where: { id },
      data: {
        name,
        description,
        parentListId: parentListId || null,
        choiceSource: list.choiceSource as ChoiceSource,
      },
    });
    if (!keepItems) {
      const nextById = new Map(items.filter((item) => item.id).map((item) => [item.id, item.value]));
      for (const old of previous) {
        const nextValue = nextById.get(old.id);
        if (!nextValue) await purgeListValue(tx, id, old.value);
        else if (nextValue !== old.value) {
          await remapChildValues(tx, id, old.value, nextValue);
          await renameStoredValues(tx, id, old.value, nextValue);
        }
      }
      await tx.choiceListItem.deleteMany({ where: { listId: id } });
      if (items.length) {
        await tx.choiceListItem.createMany({
          data: items.map((item, index) => ({
            ...(item.id ? { id: item.id } : {}),
            listId: id,
            label: item.label,
            value: item.value,
            parentValues: item.parentValues,
            isDefault: item.isDefault,
            isActive: item.isActive,
            sortOrder: index,
          })),
        });
      }
    }
    await syncFields(tx, id);
  });
  refresh();
  return { error: "" };
}

export async function searchListItems(listId: string, parentValue: string, query: string) {
  await editor();
  const list = await prisma.choiceList.findUnique({ where: { id: listId }, select: { parentListId: true } });
  if (!list) return { items: [], total: 0 };
  const parent = parentValue.trim();
  if (list.parentListId && !parent) return { items: [], total: 0 };
  const term = query.trim();
  const where = {
    listId,
    ...(list.parentListId ? { parentValues: parent } : {}),
    ...(term ? { label: { contains: term, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.choiceListItem.findMany({
      where,
      orderBy: { label: "asc" },
      take: 50,
      select: { id: true, label: true, value: true, isActive: true },
    }),
    prisma.choiceListItem.count({ where }),
  ]);
  return { items, total };
}

export async function addListItem(listId: string, parentValue: string, label: string) {
  await editor();
  const name = label.trim();
  const parent = parentValue.trim();
  if (!name) return { error: "Item name is required." };
  const list = await prisma.choiceList.findUnique({ where: { id: listId }, select: { parentListId: true } });
  if (!list) return { error: "This list was not found." };
  if (list.parentListId && !parent) return { error: "Choose a value from the list this one follows." };
  const correlated = list.parentListId ? parent : "";
  const existing = await prisma.choiceListItem.findFirst({
    where: { listId, parentValues: correlated, label: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return { error: "That item is already listed for this value." };
  await prisma.choiceListItem.create({
    data: { listId, label: name, value: name, parentValues: correlated },
  });
  refresh();
  return { error: "" };
}

export async function updateListItem(id: string, label: string, value: string, isActive: boolean) {
  await editor();
  const name = label.trim();
  const stored = value.trim() || name;
  if (!name || !stored) return { error: "Label and stored value are required." };
  const current = await prisma.choiceListItem.findUnique({
    where: { id },
    select: { listId: true, parentValues: true, value: true },
  });
  if (!current) return { error: "That item was not found." };
  const duplicate = await prisma.choiceListItem.findFirst({
    where: {
      listId: current.listId,
      parentValues: current.parentValues,
      id: { not: id },
      label: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (duplicate) return { error: "That item is already listed for this value." };
  await prisma.$transaction(async (tx) => {
    await tx.choiceListItem.update({ where: { id }, data: { label: name, value: stored, isActive } });
    if (current.value !== stored) await renameStoredValues(tx, current.listId, current.value, stored);
  });
  refresh();
  return { error: "" };
}

export async function previewListDelete(id: string) {
  await editor();
  return previewChoiceList(prisma, id);
}

export async function deleteList(id: string) {
  await editor();
  const removed = await prisma.$transaction((tx) => deleteChoiceList(tx, id));
  if (!removed) return { error: "This list was not found." };
  refresh();
  return { error: "" };
}

export async function previewListItemDelete(id: string) {
  await editor();
  return previewChoiceItem(prisma, id);
}

export async function removeListItem(id: string) {
  await editor();
  const current = await prisma.choiceListItem.findUnique({ where: { id }, select: { id: true, listId: true, value: true } });
  if (!current) return { error: "That item was not found." };
  await prisma.$transaction(async (tx) => {
    await purgeListValue(tx, current.listId, current.value);
    await tx.choiceListItem.delete({ where: { id } });
    await syncFields(tx, current.listId);
  });
  refresh();
  return { error: "" };
}
