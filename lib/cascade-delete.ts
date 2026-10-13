import type { Prisma } from "@prisma/client";
import { parentTokens } from "@/lib/list-correlation";

type Db = Prisma.TransactionClient;

export type DeletePreview = {
  error: string;
  title: string;
  message: string;
};

type Impact = {
  items: number;
  dimensions: number;
  fields: string[];
  lists: string[];
  steps: number;
};

function emptyPreview(error: string): DeletePreview {
  return { error, title: "", message: "" };
}

function countPhrase(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

function nameList(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function previewMessage(title: string, lead: string, impact: Impact, linked: boolean): DeletePreview {
  if (!linked) {
    return { error: "", title, message: lead };
  }
  const parts: string[] = [];
  if (impact.lists.length === 1) parts.push(`${impact.lists[0]} follows this list and will be removed`);
  else if (impact.lists.length > 1) parts.push(`${nameList(impact.lists)} follow this list and will be removed`);
  if (impact.fields.length === 1) parts.push(`The attribute ${impact.fields[0]} will be removed`);
  else if (impact.fields.length > 1) parts.push(`The attributes ${nameList(impact.fields)} will be removed`);
  if (impact.items) parts.push(`${countPhrase(impact.items, "list item")} will be removed`);
  if (impact.dimensions) parts.push(`Values stored on ${countPhrase(impact.dimensions, "dimension")} will be removed`);
  if (impact.steps) parts.push(`Links on ${countPhrase(impact.steps, "workflow step")} will be removed`);
  const detail = parts.map((part) => (part.endsWith(".") ? part : `${part}.`)).join(" ");
  return { error: "", title, message: detail ? `${lead} ${detail}` : lead };
}

async function descendantLists(db: Db, rootId: string) {
  const lists = await db.choiceList.findMany({ select: { id: true, name: true, parentListId: true } });
  const root = lists.find((list) => list.id === rootId);
  if (!root) return null;
  const children = new Map<string, { id: string; name: string }[]>();
  for (const list of lists) {
    if (!list.parentListId) continue;
    const bucket = children.get(list.parentListId) ?? [];
    bucket.push({ id: list.id, name: list.name });
    children.set(list.parentListId, bucket);
  }
  const ordered: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, name: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const child of children.get(id) ?? []) walk(child.id, child.name);
    ordered.push({ id, name });
  };
  walk(root.id, root.name);
  return { root, lists: ordered };
}

async function expandFields(db: Db, seedIds: string[]) {
  const fields = await db.fieldDefinition.findMany({ select: { id: true, friendlyName: true, parentFieldId: true } });
  const byParent = new Map<string, { id: string; friendlyName: string }[]>();
  for (const field of fields) {
    if (!field.parentFieldId) continue;
    const bucket = byParent.get(field.parentFieldId) ?? [];
    bucket.push(field);
    byParent.set(field.parentFieldId, bucket);
  }
  const names = new Map(fields.map((field) => [field.id, field.friendlyName]));
  const selected = new Map<string, string>();
  const queue = seedIds.filter((id) => names.has(id));
  for (const id of queue) selected.set(id, names.get(id) ?? "Attribute");
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of byParent.get(queue[index]) ?? []) {
      if (selected.has(child.id)) continue;
      selected.set(child.id, child.friendlyName);
      queue.push(child.id);
    }
  }
  return [...selected.entries()].map(([id, name]) => ({ id, name }));
}

async function dimensionCount(db: Db, fieldIds: string[]) {
  if (!fieldIds.length) return 0;
  const rows = await db.fieldValue.findMany({
    where: { fieldId: { in: fieldIds } },
    select: { locationId: true },
    distinct: ["locationId"],
  });
  return rows.length;
}

async function stepCount(db: Db, fieldIds: string[]) {
  if (!fieldIds.length) return 0;
  return db.workflowStepField.count({ where: { fieldId: { in: fieldIds } } });
}

function tokensMatch(raw: string, removed: Set<string>) {
  const tokens = parentTokens(raw);
  if (!tokens.some((token) => removed.has(token))) return null;
  return tokens.filter((token) => !removed.has(token));
}

async function matchingItems(db: Db, listId: string, removed: Set<string>) {
  const values = [...removed];
  const rows =
    values.length > 25
      ? await db.choiceListItem.findMany({
          where: { listId },
          select: { id: true, value: true, parentValues: true },
        })
      : await db.choiceListItem.findMany({
          where: {
            listId,
            OR: [
              { parentValues: { in: values } },
              ...values.map((value) => ({ parentValues: { contains: value, not: value } })),
            ],
          },
          select: { id: true, value: true, parentValues: true },
        });
  const drop: { id: string; value: string }[] = [];
  const edit: { id: string; parentValues: string }[] = [];
  for (const row of rows) {
    const next = tokensMatch(row.parentValues, removed);
    if (!next) continue;
    if (!next.length) drop.push({ id: row.id, value: row.value });
    else edit.push({ id: row.id, parentValues: next.join("|") });
  }
  return { drop, edit };
}

async function affectedLocations(db: Db, listId: string, removed: Set<string>, mutate: boolean) {
  const rows = await db.fieldValue.findMany({
    where: { field: { choiceListId: listId }, NOT: { valueText: null } },
    select: { id: true, locationId: true, valueText: true },
  });
  const locations = new Set<string>();
  for (const row of rows) {
    const next = tokensMatch(row.valueText ?? "", removed);
    if (!next) continue;
    locations.add(row.locationId);
    if (!mutate) continue;
    if (!next.length) await db.fieldValue.delete({ where: { id: row.id } });
    else await db.fieldValue.update({ where: { id: row.id }, data: { valueText: next.join("|") } });
  }
  return locations;
}

async function walkValues(db: Db, listId: string, removed: Set<string>, mutate: boolean, state: { items: number; locations: Set<string> }) {
  if (!removed.size) return;
  for (const locationId of await affectedLocations(db, listId, removed, mutate)) state.locations.add(locationId);
  const children = await db.choiceList.findMany({ where: { parentListId: listId }, select: { id: true } });
  for (const child of children) {
    const { drop, edit } = await matchingItems(db, child.id, removed);
    state.items += drop.length;
    if (mutate && drop.length) {
      await db.choiceListItem.deleteMany({ where: { id: { in: drop.map((item) => item.id) } } });
    }
    if (mutate) {
      for (const row of edit) {
        await db.choiceListItem.update({ where: { id: row.id }, data: { parentValues: row.parentValues } });
      }
    }
    const nested = new Set(drop.map((item) => item.value).filter(Boolean));
    if (nested.size) await walkValues(db, child.id, nested, mutate, state);
  }
}

export async function measureListItem(db: Db, listId: string, value: string) {
  const state = { items: 0, locations: new Set<string>() };
  await walkValues(db, listId, new Set(value ? [value] : []), false, state);
  return state;
}

export async function purgeListValue(db: Db, listId: string, value: string) {
  const state = { items: 0, locations: new Set<string>() };
  await walkValues(db, listId, new Set(value ? [value] : []), true, state);
  return state;
}

export async function previewChoiceItem(db: Db, id: string): Promise<DeletePreview> {
  const item = await db.choiceListItem.findUnique({ where: { id }, select: { label: true, value: true, listId: true } });
  if (!item) return emptyPreview("That item was not found.");
  const impact = await measureListItem(db, item.listId, item.value);
  const linked = impact.items > 0 || impact.locations.size > 0;
  return previewMessage(
    `Delete ${item.label}?`,
    linked ? `${item.label} is linked to other data.` : `${item.label} will be removed.`,
    { items: impact.items, dimensions: impact.locations.size, fields: [], lists: [], steps: 0 },
    linked,
  );
}

export async function deleteFieldGraph(db: Db, id: string) {
  const fields = await expandFields(db, [id]);
  if (!fields.some((field) => field.id === id)) return false;
  await deleteFields(db, fields.map((field) => field.id));
  return true;
}

export async function deleteFields(db: Db, ids: string[]) {
  if (!ids.length) return;
  await db.fieldDefinition.updateMany({ where: { parentFieldId: { in: ids } }, data: { parentFieldId: null } });
  await db.workflowStepField.deleteMany({ where: { fieldId: { in: ids } } });
  await db.fieldValue.deleteMany({ where: { fieldId: { in: ids } } });
  await db.fieldDefinition.deleteMany({ where: { id: { in: ids } } });
}

export async function previewChoiceList(db: Db, id: string): Promise<DeletePreview> {
  const tree = await descendantLists(db, id);
  if (!tree) return emptyPreview("This list was not found.");
  const listIds = tree.lists.map((list) => list.id);
  const direct = await db.fieldDefinition.findMany({ where: { choiceListId: { in: listIds } }, select: { id: true } });
  const fields = await expandFields(db, direct.map((field) => field.id));
  const fieldIds = fields.map((field) => field.id);
  const [items, dimensions, steps] = await Promise.all([
    db.choiceListItem.count({ where: { listId: { in: listIds } } }),
    dimensionCount(db, fieldIds),
    stepCount(db, fieldIds),
  ]);
  const childNames = tree.lists.filter((list) => list.id !== id).map((list) => list.name);
  const linked = childNames.length > 0 || fields.length > 0 || dimensions > 0 || steps > 0;
  const lead = linked
    ? `${tree.root.name} is linked to other data.`
    : items
      ? `${tree.root.name} and its ${countPhrase(items, "item")} will be removed.`
      : `${tree.root.name} will be removed.`;
  return previewMessage(`Delete ${tree.root.name}?`, lead, {
    items: linked ? items : 0,
    dimensions,
    fields: fields.map((field) => field.name),
    lists: childNames,
    steps,
  }, linked);
}

export async function deleteChoiceList(db: Db, id: string) {
  const tree = await descendantLists(db, id);
  if (!tree) return false;
  const listIds = tree.lists.map((list) => list.id);
  const direct = await db.fieldDefinition.findMany({ where: { choiceListId: { in: listIds } }, select: { id: true } });
  const fields = await expandFields(db, direct.map((field) => field.id));
  await deleteFields(db, fields.map((field) => field.id));
  await db.choiceList.updateMany({ where: { id: { in: listIds } }, data: { parentListId: null } });
  await db.choiceList.deleteMany({ where: { id: { in: listIds } } });
  return true;
}

export async function previewField(db: Db, id: string): Promise<DeletePreview> {
  const field = await db.fieldDefinition.findUnique({ where: { id }, select: { id: true, friendlyName: true } });
  if (!field) return emptyPreview("This attribute was not found.");
  const fields = await expandFields(db, [id]);
  const followers = fields.filter((item) => item.id !== id);
  const fieldIds = fields.map((item) => item.id);
  const [dimensions, steps] = await Promise.all([dimensionCount(db, fieldIds), stepCount(db, fieldIds)]);
  const linked = followers.length > 0 || dimensions > 0 || steps > 0;
  return previewMessage(
    `Delete ${field.friendlyName}?`,
    linked ? `${field.friendlyName} is linked to other data.` : `${field.friendlyName} will be removed.`,
    { items: 0, dimensions, fields: followers.map((item) => item.name), lists: [], steps },
    linked,
  );
}

export async function previewCategory(db: Db, id: string): Promise<DeletePreview> {
  const category = await db.category.findUnique({
    where: { id },
    select: { id: true, name: true, fields: { select: { id: true } } },
  });
  if (!category) return emptyPreview("This dimension was not found.");
  const fields = await expandFields(db, category.fields.map((field) => field.id));
  const fieldIds = fields.map((field) => field.id);
  const [dimensions, steps] = await Promise.all([dimensionCount(db, fieldIds), stepCount(db, fieldIds)]);
  const linked = fields.length > 0 || dimensions > 0 || steps > 0;
  return previewMessage(
    `Delete ${category.name}?`,
    linked ? `${category.name} is linked to other data.` : `${category.name} will be removed.`,
    { items: 0, dimensions, fields: fields.map((field) => field.name), lists: [], steps },
    linked,
  );
}

export async function deleteCategoryGraph(db: Db, id: string) {
  const category = await db.category.findUnique({ where: { id }, select: { fields: { select: { id: true } } } });
  if (!category) return false;
  const fields = await expandFields(db, category.fields.map((field) => field.id));
  await deleteFields(db, fields.map((field) => field.id));
  await db.category.delete({ where: { id } });
  return true;
}

/** Attributes of this record type, attributes that follow them, and attributes that link to it. */
async function recordTypeFields(db: Db, id: string) {
  const type = await db.recordType.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      categories: { select: { id: true, fields: { select: { id: true } } } },
    },
  });
  if (!type) return null;
  const owned = type.categories.flatMap((category) => category.fields.map((field) => field.id));
  const links = await db.fieldDefinition.findMany({ where: { linkTypeId: id }, select: { id: true } });
  const fields = await expandFields(db, [...owned, ...links.map((field) => field.id)]);
  return { type, fields };
}

async function deleteTypeRecords(db: Db, recordTypeId: string) {
  const locations = await db.location.findMany({ where: { recordTypeId }, select: { id: true } });
  const locationIds = locations.map((location) => location.id);
  if (!locationIds.length) return;
  const processes = await db.storeProcess.findMany({ where: { locationId: { in: locationIds } }, select: { id: true } });
  const processIds = processes.map((process) => process.id);
  const tasks = await db.task.findMany({
    where: {
      OR: [
        { locationId: { in: locationIds } },
        ...(processIds.length ? [{ storeProcessId: { in: processIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const taskIds = tasks.map((task) => task.id);
  if (taskIds.length) {
    await db.notification.updateMany({ where: { taskId: { in: taskIds } }, data: { taskId: null } });
    await db.task.deleteMany({ where: { id: { in: taskIds } } });
  }
  if (processIds.length) await db.storeProcess.deleteMany({ where: { id: { in: processIds } } });
  await db.location.deleteMany({ where: { id: { in: locationIds } } });
}

export async function previewRecordType(db: Db, id: string): Promise<DeletePreview> {
  const loaded = await recordTypeFields(db, id);
  if (!loaded) return emptyPreview("This record type was not found.");
  const fieldIds = loaded.fields.map((field) => field.id);
  const [records, steps] = await Promise.all([
    db.location.count({ where: { recordTypeId: id } }),
    stepCount(db, fieldIds),
  ]);
  const sentences: string[] = [];
  if (loaded.fields.length) {
    const names = nameList(loaded.fields.map((field) => field.name));
    const listed = loaded.fields.length === 1 ? `The attribute ${names} will be removed` : `The attributes ${names} will be removed`;
    sentences.push(`Deleting ${loaded.type.name} also removes its attribute definitions, including attributes that follow them. ${listed}.`);
  } else {
    sentences.push(`Deleting ${loaded.type.name} removes the record type. It has no attribute definitions.`);
  }
  const related = [
    loaded.type.categories.length ? countPhrase(loaded.type.categories.length, "dimension") : "",
    records ? countPhrase(records, "record") : "",
  ].filter(Boolean);
  if (related.length) sentences.push(`Its ${nameList(related)} will be removed.`);
  if (steps) sentences.push(`Links on ${countPhrase(steps, "workflow step")} will be removed.`);
  return { error: "", title: `Delete ${loaded.type.name}?`, message: sentences.join(" ") };
}

export async function deleteRecordTypeGraph(db: Db, id: string) {
  const loaded = await recordTypeFields(db, id);
  if (!loaded) return false;
  await deleteFields(db, loaded.fields.map((field) => field.id));
  await deleteTypeRecords(db, id);
  const categoryIds = loaded.type.categories.map((category) => category.id);
  if (categoryIds.length) await db.category.deleteMany({ where: { id: { in: categoryIds } } });
  await db.fieldDefinition.updateMany({ where: { linkTypeId: id }, data: { linkTypeId: null } });
  await db.changeProposal.deleteMany({ where: { recordTypeId: id } });
  await db.importJob.deleteMany({ where: { recordTypeId: id } });
  await db.recordType.delete({ where: { id } });
  return true;
}
