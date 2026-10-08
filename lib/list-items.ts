import { parentTokens } from "@/lib/list-correlation";
import { prisma } from "@/lib/prisma";

export type ItemChoice = { label: string; value: string; parentValues?: string };

export async function choicesForList(listId: string, parentValue: string | null): Promise<ItemChoice[]> {
  const tokens = parentValue == null ? null : parentTokens(parentValue);
  if (tokens && tokens.length === 0) return [];
  const items = await prisma.choiceListItem.findMany({
    where: {
      listId,
      isActive: true,
      ...(tokens
        ? {
            OR: [
              { parentValues: "" },
              { parentValues: { in: tokens } },
              ...tokens.map((token) => ({ parentValues: { contains: token } })),
            ],
          }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { label: true, value: true, parentValues: true },
  });
  if (!tokens) return items.map(({ label, value }) => ({ label, value }));
  const selected = new Set(tokens);
  return items
    .filter((item) => {
      const parents = parentTokens(item.parentValues);
      if (!parents.length) return true;
      return parents.some((value) => selected.has(value));
    })
    .map(({ label, value, parentValues }) => ({ label, value, parentValues }));
}

export type FieldChoiceMeta = { remote: boolean; options: ItemChoice[] };

export async function loadFieldChoices(
  fields: { id: string; choiceListId: string | null; parentFieldId: string | null }[],
  parentValueOf: (fieldId: string) => string,
): Promise<Map<string, FieldChoiceMeta>> {
  const listIds = [...new Set(fields.map((field) => field.choiceListId).filter((id): id is string => Boolean(id)))];
  if (!listIds.length) return new Map();
  const lists = await prisma.choiceList.findMany({
    where: { id: { in: listIds } },
    select: { id: true, parentListId: true },
  });
  const listById = new Map(lists.map((list) => [list.id, list]));
  const rootIds = lists.filter((list) => !list.parentListId).map((list) => list.id);
  const rootItems = rootIds.length
    ? await prisma.choiceListItem.findMany({
        where: { listId: { in: rootIds }, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        select: { listId: true, label: true, value: true },
      })
    : [];
  const rootByList = new Map<string, ItemChoice[]>();
  for (const item of rootItems) {
    const bucket = rootByList.get(item.listId) ?? [];
    bucket.push({ label: item.label, value: item.value });
    rootByList.set(item.listId, bucket);
  }

  const result = new Map<string, FieldChoiceMeta>();
  const childKeys = new Map<string, Promise<ItemChoice[]>>();
  for (const field of fields) {
    const list = field.choiceListId ? listById.get(field.choiceListId) : undefined;
    if (!list) continue;
    if (!list.parentListId) {
      result.set(field.id, { remote: false, options: rootByList.get(list.id) ?? [] });
      continue;
    }
    const parentValue = field.parentFieldId ? parentValueOf(field.parentFieldId) : "";
    const key = `${list.id}\n${parentValue}`;
    const pending = childKeys.get(key) ?? choicesForList(list.id, parentValue);
    childKeys.set(key, pending);
    result.set(field.id, { remote: true, options: await pending });
  }
  return result;
}
