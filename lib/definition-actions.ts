"use server";

import { normalizeFileTypes } from "@/lib/files";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ChoiceSource, DataType, Prisma } from "@prisma/client";
import { deleteCategoryGraph, deleteFieldGraph, deleteRecordTypeGraph, previewCategory, previewField, previewRecordType } from "@/lib/cascade-delete";
import { audited } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canEditModule, canViewModule, categoryAccess, loadAccess } from "@/lib/permissions";
import { allowedIds } from "@/lib/row-scope";
import { buildStoreTargets } from "@/lib/store-targets";
import { getCurrentUser } from "@/lib/session";
import { choicesForList } from "@/lib/list-items";
import { displayRaw, displayStored, inputToStored, rulesFromField } from "@/lib/values";
import { enqueueRecordEvent } from "@/lib/webhooks";
import { withLinkOptions } from "@/lib/record-types";
import { runWorkflows, type SavedChange } from "@/lib/workflow";
import {
  columnKeyError,
  compilePattern,
  DATA_TYPES,
  validateValue,
  type DataTypeName,
  type FieldRules,
} from "@/lib/validators";

async function correlationError(fieldId: string, parentId: string) {
  if (fieldId && fieldId === parentId) return "A list cannot follow itself.";
  const parent = await prisma.fieldDefinition.findUnique({ where: { id: parentId } });
  if (!parent || (parent.dataType !== "DROPDOWN" && parent.dataType !== "RADIO")) {
    return "Choose a list for this attribute to follow.";
  }
  let cursor = parent.parentFieldId;
  const seen = new Set<string>([parentId]);
  while (cursor) {
    if (cursor === fieldId) return "That correlation loops back to this attribute.";
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const next = await prisma.fieldDefinition.findUnique({ where: { id: cursor }, select: { parentFieldId: true } });
    cursor = next?.parentFieldId ?? null;
  }
  return null;
}

async function editor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  return { user, access };
}

function definitionError(access: Awaited<ReturnType<typeof editor>>["access"]) {
  return canEditModule(access, "DEFINITION") ? "" : "You cannot change data definitions.";
}

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalNumber(formData: FormData, name: string) {
  const value = text(formData, name);
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function saveCategory(formData: FormData) {
  return audited("definition.saveCategory", [formData], async () => {
    const { user, access } = await editor();
    const id = text(formData, "id");
    const name = text(formData, "name");
    const description = text(formData, "description");
    if (!name) redirect("/admin/definition?error=Dimension%20name%20is%20required.");

    const blocked = definitionError(access);
    if (blocked) redirect(`/admin/definition?error=${encodeURIComponent(blocked)}`);
    // Dimension names are unique across record types, so a name always means one dimension
    // in permissions, imports, the API, and AI knowledge.
    const clash = await prisma.category.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) },
      include: { recordType: { select: { name: true } } },
    });
    if (clash) redirect(`/admin/definition?error=${encodeURIComponent(`${clash.recordType.name} already has a dimension named ${clash.name}. Choose another name.`)}`);
    if (!id) {
      const recordType = await prisma.recordType.findFirst({ where: { id: text(formData, "recordTypeId"), isActive: true } });
      if (!recordType) redirect("/admin/definition?error=Choose%20a%20record%20type%20for%20the%20dimension.");
      const last = await prisma.category.aggregate({ _max: { sortOrder: true } });
      await prisma.category.create({
        data: { name, description, recordTypeId: recordType.id, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      });
    } else {
      const rights = categoryAccess(access, id);
      if (!user.isAdmin && !rights.canEditCategory) redirect("/admin/definition?error=You%20cannot%20edit%20this%20dimension.");
      await prisma.category.update({ where: { id }, data: { name, description } });
    }
    revalidatePath("/admin/definition");
  });
}

export async function moveCategory(formData: FormData) {
  return audited("definition.moveCategory", [formData], async () => {
    const { user, access } = await editor();
    const id = text(formData, "id");
    const direction = text(formData, "direction") === "up" ? -1 : 1;
    const current = await prisma.category.findUnique({ where: { id }, select: { recordTypeId: true } });
    const categories = await prisma.category.findMany({
      where: { isActive: true, recordTypeId: current?.recordTypeId ?? "" },
      orderBy: { sortOrder: "asc" },
    });
    const index = categories.findIndex((category) => category.id === id);
    const swap = categories[index + direction];
    if (!swap || index < 0) return;
    if (definitionError(access)) return;
    const rights = categoryAccess(access, id);
    if (!user.isAdmin && !rights.canEditCategory) return;
    await prisma.$transaction([
      prisma.category.update({ where: { id }, data: { sortOrder: swap.sortOrder } }),
      prisma.category.update({ where: { id: swap.id }, data: { sortOrder: categories[index].sortOrder } }),
    ]);
    revalidatePath("/admin/definition");
  });
}

export async function previewCategoryDelete(id: string) {
  const { access } = await editor();
  const blocked = definitionError(access);
  if (blocked) return { error: blocked, title: "", message: "" };
  return previewCategory(prisma, id);
}

export async function deleteCategory(id: string) {
  return audited("definition.deleteCategory", [id], async () => {
    const { access } = await editor();
    const blocked = definitionError(access);
    if (blocked) return { error: blocked };
    const removed = await prisma.$transaction((tx) => deleteCategoryGraph(tx, id));
    if (!removed) return { error: "This dimension was not found." };
    revalidatePath("/admin/definition");
    revalidatePath("/dimensions");
    return { error: "" };
  });
}

export async function previewFieldDelete(id: string) {
  const { user, access } = await editor();
  const blocked = definitionError(access);
  if (blocked) return { error: blocked, title: "", message: "" };
  const field = await prisma.fieldDefinition.findUnique({ where: { id }, select: { categoryId: true } });
  if (!field) return { error: "This attribute was not found.", title: "", message: "" };
  const rights = categoryAccess(access, field.categoryId);
  if (!user.isAdmin && !rights.canRemoveFields) return { error: "You cannot delete this attribute.", title: "", message: "" };
  return previewField(prisma, id);
}

export async function deleteField(id: string) {
  return audited("definition.deleteField", [id], async () => {
    const { user, access } = await editor();
    const blocked = definitionError(access);
    if (blocked) return { error: blocked };
    const field = await prisma.fieldDefinition.findUnique({ where: { id }, select: { categoryId: true } });
    if (!field) return { error: "This attribute was not found." };
    const rights = categoryAccess(access, field.categoryId);
    if (!user.isAdmin && !rights.canRemoveFields) return { error: "You cannot delete this attribute." };
    const removed = await prisma.$transaction((tx) => deleteFieldGraph(tx, id));
    if (!removed) return { error: "This attribute was not found." };
    revalidatePath("/admin/definition");
    revalidatePath("/dimensions");
    revalidatePath("/admin/lists");
    return { error: "" };
  });
}

export async function saveField(formData: FormData) {
  return audited("definition.saveField", [formData], async () => {
    const { user, access } = await editor();
    const id = text(formData, "id");
    const categoryId = text(formData, "categoryId");
    const blocked = definitionError(access);
    if (blocked) return { error: blocked };
    const rights = categoryAccess(access, categoryId);
    const existing = id
      ? await prisma.fieldDefinition.findUnique({ where: { id }, include: { values: { take: 1 } } })
      : null;
    if (!existing && !user.isAdmin && !rights.canAddFields) return { error: "You cannot add attributes in this dimension." };
    if (existing && !user.isAdmin && !rights.canEditFields) return { error: "You cannot edit attributes in this dimension." };

    const key = text(formData, "key");
    const friendlyName = text(formData, "friendlyName");
    const keyError = columnKeyError(key);
    if (keyError) return { error: keyError };
    if (!friendlyName) return { error: "Display name is required." };

    const dataType = text(formData, "dataType") as DataTypeName;
    if (!DATA_TYPES.includes(dataType)) return { error: "Choose an attribute type." };
    if (existing && existing.dataType !== dataType && existing.values.length > 0) {
      return { error: "This attribute already has dimension values, so its type cannot be changed. Hide it and add a new attribute." };
    }

    const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { recordTypeId: true } });
    if (!category) return { error: "This dimension was not found." };
    if (existing && existing.categoryId !== categoryId) return { error: "An attribute cannot move to another dimension." };
    const linkTypeId = dataType === "RECORD_LINK" ? text(formData, "linkTypeId") : "";
    if (dataType === "RECORD_LINK") {
      const target = linkTypeId ? await prisma.recordType.findUnique({ where: { id: linkTypeId } }) : null;
      if (!target) return { error: "Choose the record type this attribute links to." };
      if (existing && existing.linkTypeId && existing.linkTypeId !== linkTypeId && existing.values.length > 0) {
        return { error: "This attribute already links to records, so its target type cannot be changed. Hide it and add a new attribute." };
      }
    }

    const listField = dataType === "DROPDOWN" || dataType === "RADIO";
    const requestedListId = listField ? text(formData, "choiceListId") : "";
    const choiceList = requestedListId
      ? await prisma.choiceList.findUnique({ where: { id: requestedListId } })
      : null;
    const manualItems =
      choiceList && choiceList.choiceSource === "MANUAL" && !choiceList.parentListId
        ? await prisma.choiceListItem.findMany({
            where: { listId: choiceList.id, isActive: true },
            orderBy: { sortOrder: "asc" },
          })
        : [];
    if (listField && !choiceList) return { error: "Choose a list." };
    if (choiceList && !choiceList.isActive && existing?.choiceListId !== choiceList.id) {
      return { error: "That list is inactive. Activate it before using it on an attribute." };
    }
    const choiceSource: ChoiceSource = choiceList?.choiceSource ?? "MANUAL";
    const options = manualItems.map((option) => ({
      label: option.label,
      value: option.value,
      isDefault: option.isDefault,
      parentValues: option.parentValues,
    }));
    const requestedParent = listField ? text(formData, "parentFieldId") : "";
    const parentError = requestedParent ? await correlationError(id, requestedParent) : null;
    if (parentError) return { error: parentError };
    const activeItems = choiceList
      ? await prisma.choiceListItem.count({ where: { listId: choiceList.id, isActive: true } })
      : 0;
    if (dataType === "RADIO" && choiceList && (activeItems < 2 || activeItems > 5)) {
      return { error: "A radio attribute needs a list with between 2 and 5 active items." };
    }
    if (dataType === "DROPDOWN" && choiceList && activeItems < 1) {
      return { error: "A list attribute needs a list with at least one active item." };
    }

    // Only text attributes have a length limit; the attribute form posts its default for every type.
    const maxLength = dataType === "TEXT" || dataType === "BIG_TEXT" ? optionalNumber(formData, "maxLength") : null;
    if (dataType === "TEXT" && (maxLength == null || maxLength < 1 || maxLength > 512)) {
      return { error: "Text max length is required and must be from 1 to 512." };
    }
    if (dataType === "BIG_TEXT" && (maxLength == null || maxLength < 1 || maxLength > 6400)) {
      return { error: "Big text max length is required and must be from 1 to 6400." };
    }

    const isFile = dataType === "FILE";
    const fileTypes = isFile ? normalizeFileTypes(text(formData, "fileTypes")) : { value: "" };
    if (fileTypes.error) return { error: fileTypes.error };

    const rules: FieldRules = {
      dataType,
      isRequired: formData.get("isRequired") === "on",
      validationPattern: isFile ? "" : text(formData, "validationPattern"),
      useRegex: true,
      formatExample: isFile ? "" : text(formData, "formatExample"),
      maxLength,
      minValue: optionalNumber(formData, "minValue"),
      maxValue: optionalNumber(formData, "maxValue"),
      negativeOk: formData.get("negativeOk") === "on",
      decimalOk: formData.get("decimalOk") === "on",
      is24Hour: formData.get("is24Hour") === "on",
      minDate: text(formData, "minDate"),
      maxDate: text(formData, "maxDate"),
      multiple: formData.get("multiple") === "on",
      options: options.map((option) => ({ label: option.label, value: option.value || option.label })),
    };
    const patternError = await compilePattern(rules);
    if (patternError) return { error: patternError };

    const data: Prisma.FieldDefinitionUncheckedCreateInput = {
      key,
      friendlyName,
      description: text(formData, "description"),
      dataType: dataType as DataType,
      categoryId,
      linkTypeId: linkTypeId || null,
      isRequired: rules.isRequired,
      isStoreKey: !isFile && formData.get("isStoreKey") === "on",
      isActiveFilter: dataType === "CHECKBOX" && formData.get("isActiveFilter") === "on",
      isCreatedDate: dataType === "DATE" && formData.get("isCreatedDate") === "on",
      choiceSource,
      choiceListId: choiceList?.id ?? null,
      parentFieldId: requestedParent || null,
      defaultValue: isFile ? "" : text(formData, "defaultValue"),
      formatExample: rules.formatExample,
      validationPattern: rules.validationPattern,
      useRegex: rules.useRegex,
      maxLength,
      minValue: rules.minValue,
      maxValue: rules.maxValue,
      negativeOk: rules.negativeOk,
      decimalOk: rules.decimalOk,
      numVisible: optionalNumber(formData, "numVisible") ?? 1,
      multiple: rules.multiple && (dataType === "DROPDOWN" || dataType === "RECORD_LINK" || isFile),
      fileTypes: fileTypes.value,
      is24Hour: rules.is24Hour || dataType !== "TIME",
      checkboxLabel: text(formData, "checkboxLabel"),
      minDate: rules.minDate,
      maxDate: rules.maxDate,
    };

    // Each record type has at most one unique identifier, one active filter, and one created date.
    const sameType = { category: { recordTypeId: category.recordTypeId } };
    const saved = await prisma.$transaction(async (tx) => {
      if (data.isStoreKey) {
        await tx.fieldDefinition.updateMany({ data: { isStoreKey: false }, where: { isStoreKey: true, ...sameType } });
      }
      if (data.isActiveFilter) {
        await tx.fieldDefinition.updateMany({ data: { isActiveFilter: false }, where: { isActiveFilter: true, ...sameType } });
      }
      if (data.isCreatedDate) {
        await tx.fieldDefinition.updateMany({ data: { isCreatedDate: false }, where: { isCreatedDate: true, ...sameType } });
      }
      const field = existing
        ? await tx.fieldDefinition.update({ where: { id }, data })
        : await tx.fieldDefinition.create({
            data: {
              ...data,
              sortOrder:
                ((await tx.fieldDefinition.aggregate({ where: { categoryId }, _max: { sortOrder: true } }))._max.sortOrder ??
                  -1) + 1,
            },
          });
      await tx.fieldOption.deleteMany({ where: { fieldId: field.id } });
      if (options.length) {
        await tx.fieldOption.createMany({
          data: options.map((option, index) => ({
            fieldId: field.id,
            label: option.label,
            value: option.value || option.label,
            parentValues: option.parentValues ?? "",
            isDefault: Boolean(option.isDefault),
            sortOrder: index,
          })),
        });
      }
      return field;
    });

    revalidatePath("/admin/definition");
    revalidatePath("/dimensions");
    if (!existing) redirect(`/admin/definition?added=${saved.id}&category=${categoryId}`);
    return { error: "" };
  });
}

export async function setFieldActive(formData: FormData) {
  return audited("definition.setFieldActive", [formData], async () => {
    const { user, access } = await editor();
    const id = text(formData, "id");
    const active = text(formData, "active") === "1";
    const field = await prisma.fieldDefinition.findUnique({ where: { id } });
    if (!field || definitionError(access)) return;
    const rights = categoryAccess(access, field.categoryId);
    if (active && !user.isAdmin && !rights.canAddFields) return;
    if (!active && !user.isAdmin && !rights.canRemoveFields) return;
    await prisma.fieldDefinition.update({ where: { id }, data: { isActive: active } });
    revalidatePath("/admin/definition");
    revalidatePath("/dimensions");
  });
}

export async function moveField(formData: FormData) {
  return audited("definition.moveField", [formData], async () => {
    const { user, access } = await editor();
    const id = text(formData, "id");
    const direction = text(formData, "direction") === "up" ? -1 : 1;
    const field = await prisma.fieldDefinition.findUnique({ where: { id } });
    if (!field || definitionError(access)) return;
    const rights = categoryAccess(access, field.categoryId);
    if (!user.isAdmin && !rights.canEditCategory) return;
    const fields = await prisma.fieldDefinition.findMany({
      where: { categoryId: field.categoryId },
      orderBy: { sortOrder: "asc" },
    });
    const index = fields.findIndex((item) => item.id === id);
    const swap = fields[index + direction];
    if (!swap) return;
    await prisma.$transaction([
      prisma.fieldDefinition.update({ where: { id }, data: { sortOrder: swap.sortOrder } }),
      prisma.fieldDefinition.update({ where: { id: swap.id }, data: { sortOrder: fields[index].sortOrder } }),
    ]);
    revalidatePath("/admin/definition");
  });
}

export async function loadStoreTargets(fieldId: string) {
  const { access } = await editor();
  if (!canViewModule(access, "DEFINITION")) return [];
  return buildStoreTargets(fieldId, access);
}

export async function applyDefaultToStores(fieldId: string, locationIds: string[], raw: string) {
  return audited("definition.applyDefaultToStores", [fieldId, locationIds, raw], async () => {
    const { user, access } = await editor();
    const blocked = definitionError(access);
    if (blocked) return { error: blocked, applied: 0 };
    const loaded = await prisma.fieldDefinition.findUnique({ where: { id: fieldId }, include: { options: true, category: { select: { recordTypeId: true } } } });
    if (!loaded) return { error: "This attribute was not found.", applied: 0 };
    const [field] = await withLinkOptions([loaded], access);
    if (field.isCreatedDate) return { error: `${field.friendlyName} is filled in when the dimension is added.`, applied: 0 };
    const rights = categoryAccess(access, field.categoryId);
    if (!user.isAdmin && !rights.canEditFields) return { error: "You cannot update this attribute.", applied: 0 };

    const rules = rulesFromField(field);
    if (field.choiceListId) {
      const list = await prisma.choiceList.findUnique({ where: { id: field.choiceListId }, select: { parentListId: true } });
      const chosen = raw.trim();
      if (list?.parentListId) {
        if (chosen) {
          const found = await prisma.choiceListItem.findFirst({
            where: { listId: field.choiceListId, isActive: true, value: chosen },
            select: { label: true, value: true },
          });
          if (!found) return { error: "Choose a value from the list.", applied: 0 };
          rules.options = [found];
        }
      } else {
        rules.options = await choicesForList(field.choiceListId, null);
      }
    }
    const invalid = await validateValue(rules, raw);
    if (invalid) return { error: invalid, applied: 0 };

    const ids = [...new Set(locationIds.filter(Boolean))];
    if (!ids.length) return { error: "Choose at least one dimension.", applied: 0 };
    const allowed = await allowedIds(access, field.category.recordTypeId);
    const visibleIds = allowed ? ids.filter((id) => allowed.includes(id)) : ids;
    const found = await prisma.location.findMany({
      where: { id: { in: visibleIds }, isActive: true, recordTypeId: field.category.recordTypeId },
      select: { id: true },
    });
    if (found.length !== ids.length) return { error: "One of the selected dimensions is no longer available.", applied: 0 };

    if (field.isStoreKey && raw.trim() && found.length > 1) {
      return { error: `${field.friendlyName} is a unique identifier, so one value cannot be applied to several dimensions.`, applied: 0 };
    }

    // Bulk updates are recorded in the changelog and run workflows like any other edit,
    // so the changelog, notifications, and AI knowledge stay complete.
    const stored = inputToStored(field, raw);
    const newValue = displayRaw(field, raw, rules.options);
    const changed = await prisma.$transaction(async (tx) => {
      const previous = await tx.fieldValue.findMany({ where: { fieldId: field.id, locationId: { in: found.map((row) => row.id) } } });
      const result: { locationId: string; change: SavedChange }[] = [];
      for (const location of found) {
        const oldValue = displayStored(field, previous.find((value) => value.locationId === location.id), rules.options);
        await tx.fieldValue.upsert({
          where: { locationId_fieldId: { locationId: location.id, fieldId: field.id } },
          update: stored,
          create: { locationId: location.id, fieldId: field.id, ...stored },
        });
        if (oldValue === newValue) continue;
        const row = await tx.fieldChange.create({
          data: { locationId: location.id, fieldId: field.id, userId: user.id, oldValue, newValue },
        });
        result.push({
          locationId: location.id,
          change: { id: row.id, fieldId: field.id, categoryId: field.categoryId, attribute: field.friendlyName, oldValue, newValue },
        });
      }
      return result;
    });
    for (const item of changed) {
      await runWorkflows({ locationId: item.locationId, userId: user.id, userName: user.name, created: false, changes: [item.change] });
      await enqueueRecordEvent({ event: "record.updated", locationId: item.locationId, actorName: user.name, changes: [item.change] });
    }
    revalidatePath("/dimensions");
    revalidatePath("/changelog");
    revalidatePath("/dashboard");
    return { error: "", applied: found.length };
  });
}

/** Creates or renames a record type. */
export async function saveRecordType(formData: FormData) {
  return audited("definition.saveRecordType", [formData], async () => {
    const { access } = await editor();
    const blocked = definitionError(access);
    if (blocked) redirect(`/admin/definition?error=${encodeURIComponent(blocked)}`);
    const id = text(formData, "id");
    const name = text(formData, "name");
    const description = text(formData, "description");
    if (!name) redirect("/admin/definition?error=Enter%20a%20record%20type%20name.");
    if (name.length > 60) redirect("/admin/definition?error=Use%20at%20most%2060%20characters.");
    const clash = await prisma.recordType.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) },
    });
    if (clash) redirect(`/admin/definition?error=${encodeURIComponent(`A record type named ${clash.name} already exists.`)}`);
    if (id) {
      await prisma.recordType.update({ where: { id }, data: { name, description } });
    } else {
      const last = await prisma.recordType.aggregate({ _max: { sortOrder: true } });
      await prisma.recordType.create({ data: { name, description, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    }
    revalidatePath("/admin/definition");
    revalidatePath("/dimensions");
    redirect("/admin/definition?saved=type");
  });
}

export async function previewRecordTypeDelete(id: string) {
  const { access } = await editor();
  const blocked = definitionError(access);
  if (blocked) return { error: blocked, title: "", message: "" };
  return previewRecordType(prisma, id);
}

/** Removes a record type and the attribute definitions that belong to it, including attributes that follow them. */
export async function deleteRecordType(id: string) {
  return audited("definition.deleteRecordType", [id], async () => {
    const { access } = await editor();
    const blocked = definitionError(access);
    if (blocked) return { error: blocked };
    const removed = await prisma.$transaction((tx) => deleteRecordTypeGraph(tx, id));
    if (!removed) return { error: "This record type was not found." };
    revalidatePath("/admin/definition");
    revalidatePath("/dimensions");
    revalidatePath("/changelog");
    revalidatePath("/dashboard");
    revalidatePath("/proposals");
    return { error: "" };
  });
}

/** Hides or shows a record type. Its dimensions, attributes, and records are kept. */
export async function setRecordTypeActive(formData: FormData) {
  return audited("definition.setRecordTypeActive", [formData], async () => {
    const { access } = await editor();
    const blocked = definitionError(access);
    if (blocked) redirect(`/admin/definition?error=${encodeURIComponent(blocked)}`);
    const id = text(formData, "id");
    const isActive = text(formData, "active") === "1";
    if (!isActive && (await prisma.recordType.count({ where: { isActive: true, id: { not: id } } })) === 0) {
      redirect("/admin/definition?error=At%20least%20one%20record%20type%20must%20stay%20active.");
    }
    await prisma.recordType.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/definition");
    revalidatePath("/dimensions");
    redirect("/admin/definition?saved=type");
  });
}
