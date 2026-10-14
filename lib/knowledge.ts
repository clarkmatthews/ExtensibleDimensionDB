import type { FieldDefinition, FieldValue } from "@prisma/client";
import type { AccessContext, AccessUser } from "@/lib/permissions";
import { canSeeValue, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { linkedFrom, recordLabels } from "@/lib/record-types";
import { catchUpFileText, fileText, visibleFile } from "@/lib/file-access";
import { parseFileTokens } from "@/lib/files";
import { checkboxCheckedText, displayStored, type DefinedField } from "@/lib/values";

const SEARCH_LIMIT = 25;
const CHANGE_LIMIT = 200;

type LoadedField = FieldDefinition & {
  category: { id: string; name: string; description: string; sortOrder: number; recordType: { id: string; name: string } };
  linkType: { id: string; name: string } | null;
  choiceList: { id: string; name: string } | null;
  parentField: { id: string; key: string; friendlyName: string } | null;
};

export type SchemaAttribute = {
  key: string;
  displayName: string;
  description: string;
  dimension: string;
  dataType: string;
  uniqueIdentifier: boolean;
  choiceList: string | null;
  follows: string | null;
  linksTo: string | null;
};

export type SchemaDimension = {
  recordType: string;
  name: string;
  description: string;
  attributes: SchemaAttribute[];
};

export async function loadKnowledgeUser(email: string): Promise<AccessContext> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { groups: true },
  });
  if (!user || !user.isActive) {
    throw new Error(`No active user for ${email || "MCP_USER_EMAIL"}.`);
  }
  return loadAccess(user as AccessUser);
}

async function visibleFields(ctx: AccessContext) {
  const fields = await prisma.fieldDefinition.findMany({
    where: { isActive: true, category: { isActive: true } },
    include: {
      category: { select: { id: true, name: true, description: true, sortOrder: true, recordType: { select: { id: true, name: true } } } },
      linkType: { select: { id: true, name: true } },
      choiceList: { select: { id: true, name: true } },
      parentField: { select: { id: true, key: true, friendlyName: true } },
    },
    orderBy: [{ category: { recordType: { sortOrder: "asc" } } }, { category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  return fields.filter((field) => field.category.recordType && canSeeValue(ctx, field.id, field.categoryId));
}

export async function schemaCatalog(ctx: AccessContext) {
  const fields = await visibleFields(ctx);
  const dimensions: SchemaDimension[] = [];
  for (const field of fields) {
    let dimension = dimensions.find((item) => item.name === field.category.name);
    if (!dimension) {
      dimension = { recordType: field.category.recordType.name, name: field.category.name, description: field.category.description, attributes: [] };
      dimensions.push(dimension);
    }
    dimension.attributes.push({
      key: field.key,
      displayName: field.friendlyName,
      description: field.description,
      dimension: field.category.name,
      dataType: field.dataType,
      uniqueIdentifier: field.isStoreKey,
      choiceList: field.choiceList?.name ?? null,
      follows: field.parentField ? `${field.parentField.key} (${field.parentField.friendlyName})` : null,
      linksTo: field.linkType?.name ?? null,
    });
  }
  return dimensions;
}

export function schemaText(dimensions: SchemaDimension[]) {
  if (!dimensions.length) return "No visible dimensions.";
  let recordType = "";
  return dimensions
    .map((dimension) => {
      const lines: string[] = [];
      if (dimension.recordType !== recordType) {
        recordType = dimension.recordType;
        lines.push(`Record type: ${recordType}`);
      }
      lines.push(`Dimension: ${dimension.name}`);
      if (dimension.description) lines.push(dimension.description);
      for (const attribute of dimension.attributes) {
        const parts = [
          `- ${attribute.key}: ${attribute.displayName}`,
          attribute.description,
          `Type ${attribute.dataType}`,
          attribute.uniqueIdentifier ? "Unique identifier" : "",
          attribute.choiceList ? `List: ${attribute.choiceList}` : "",
          attribute.follows ? `Follows: ${attribute.follows}` : "",
          attribute.linksTo ? `Links to a ${attribute.linksTo} record` : "",
        ].filter(Boolean);
        lines.push(parts.join(". ") + ".");
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function definedField(field: LoadedField, options: { label: string; value: string }[]): DefinedField {
  return {
    ...field,
    options: options.map((option, index) => ({
      id: String(index),
      fieldId: field.id,
      label: option.label,
      value: option.value,
      parentValues: "",
      isDefault: false,
      sortOrder: index,
    })),
  };
}

/** Key in the label map that holds record labels for link attributes. */
const LINK_LABELS = "\u0000links";

async function labelsFor(fields: LoadedField[], values: FieldValue[]) {
  const wanted = new Map<string, Set<string>>();
  for (const value of values) {
    const field = fields.find((item) => item.id === value.fieldId);
    if (!field?.choiceListId || !value.valueText) continue;
    const bucket = wanted.get(field.choiceListId) ?? new Set<string>();
    for (const token of value.valueText.split("|")) {
      if (token) bucket.add(token);
    }
    wanted.set(field.choiceListId, bucket);
  }
  const labels = new Map<string, Map<string, string>>();
  for (const [listId, tokens] of wanted) {
    if (!tokens.size) continue;
    const items = await prisma.choiceListItem.findMany({
      where: { listId, isActive: true, value: { in: [...tokens] } },
      select: { value: true, label: true },
    });
    labels.set(listId, new Map(items.map((item) => [item.value, item.label])));
  }
  const linkIds = values.flatMap((value) => {
    const field = fields.find((item) => item.id === value.fieldId);
    return field?.dataType === "RECORD_LINK" && value.valueText ? value.valueText.split("|").filter(Boolean) : [];
  });
  if (linkIds.length) labels.set(LINK_LABELS, await recordLabels(linkIds));
  return labels;
}

function displayValue(field: LoadedField, value: FieldValue | undefined, labels: Map<string, Map<string, string>>) {
  if (field.dataType === "FILE") {
    // The id lets an assistant read the file with read_file.
    return parseFileTokens(value?.valueText).map((file) => `${file.name} [file ${file.id}]`).join(", ");
  }
  if (field.dataType === "RECORD_LINK") {
    const links = labels.get(LINK_LABELS) ?? new Map<string, string>();
    const options = (value?.valueText ?? "").split("|").filter(Boolean).map((id) => ({ label: links.get(id) ?? id, value: id }));
    return displayStored(definedField(field, options), value, options);
  }
  const options = field.choiceListId
    ? [...(labels.get(field.choiceListId) ?? new Map()).entries()].map(([stored, label]) => ({ label, value: stored }))
    : [];
  return displayStored(definedField(field, options), value, options);
}

export function knowledgeCard(
  allFields: LoadedField[],
  values: FieldValue[],
  labels: Map<string, Map<string, string>>,
  recordId: string,
  recordType?: { id: string; name: string },
) {
  // A card only shows the attributes of its own record type.
  const fields = recordType ? allFields.filter((field) => field.category.recordType.id === recordType.id) : allFields;
  const byField = new Map(values.map((value) => [value.fieldId, value]));
  const storeKey = fields.find((field) => field.isStoreKey);
  const subject = storeKey ? displayValue(storeKey, byField.get(storeKey.id), labels) : "";
  const lines = [`Record: ${recordId}`, ...(recordType ? [`Type: ${recordType.name}`] : []), `Subject: ${subject || recordId}`];
  let dimension = "";
  for (const field of fields) {
    const shown = displayValue(field, byField.get(field.id), labels);
    if (!shown) continue;
    if (field.category.name !== dimension) {
      dimension = field.category.name;
      lines.push(`Dimension: ${dimension}`);
    }
    lines.push(field.description ? `${field.friendlyName}: ${shown} (${field.description})` : `${field.friendlyName}: ${shown}`);
  }
  return lines.join("\n");
}

async function cardsFor(fields: LoadedField[], requestedIds: string[]) {
  if (!requestedIds.length || !fields.length) return [];
  // Archived records are not knowledge.
  const active = new Map(
    (
      await prisma.location.findMany({
        where: { id: { in: requestedIds }, isActive: true },
        select: { id: true, recordType: { select: { id: true, name: true } } },
      })
    ).map((row) => [row.id, row.recordType]),
  );
  const locationIds = requestedIds.filter((id) => active.has(id));
  if (!locationIds.length) return [];
  const values = await prisma.fieldValue.findMany({
    where: { locationId: { in: locationIds }, fieldId: { in: fields.map((field) => field.id) } },
  });
  const labels = await labelsFor(fields, values);
  return locationIds.map((id) => knowledgeCard(fields, values.filter((value) => value.locationId === id), labels, id, active.get(id)));
}

export async function exportKnowledgeMarkdown(ctx: AccessContext) {
  const fields = await visibleFields(ctx);
  const dimensions = await schemaCatalog(ctx);
  const rows = fields.length
    ? await prisma.fieldValue.findMany({
        where: { fieldId: { in: fields.map((field) => field.id) } },
        select: { locationId: true },
        distinct: ["locationId"],
      })
    : [];
  const cards = (await cardsFor(fields, rows.map((row) => row.locationId))).sort((left, right) => {
    const subject = (card: string) => card.split("\n").find((line) => line.startsWith("Subject: "))?.slice("Subject: ".length) ?? "";
    return subject(left).localeCompare(subject(right), undefined, { sensitivity: "base" }) || left.localeCompare(right);
  });
  return ["# Schema", "", schemaText(dimensions), "", "# Records", "", cards.join("\n\n") || "No visible records.", ""].join("\n");
}

async function subjectLabels(locationIds: string[]) {
  if (!locationIds.length) return new Map<string, string>();
  const keys = await prisma.fieldValue.findMany({
    where: { locationId: { in: locationIds }, field: { isStoreKey: true } },
    select: { locationId: true, valueText: true },
  });
  return new Map(keys.map((row) => [row.locationId, row.valueText || row.locationId]));
}

export async function searchRecords(
  ctx: AccessContext,
  input: { query?: string; type?: string; dimension?: string; attribute?: string },
) {
  const query = input.query?.trim() ?? "";
  if (!query) return "query is required.";
  const typeName = input.type?.trim().toLowerCase();
  const allFields = await visibleFields(ctx);
  if (typeName && !allFields.some((field) => field.category.recordType.name.toLowerCase() === typeName)) {
    return "No visible record type matches that name.";
  }
  const fields = typeName ? allFields.filter((field) => field.category.recordType.name.toLowerCase() === typeName) : allFields;
  const dimensionName = input.dimension?.trim();
  if (dimensionName && !fields.some((field) => field.category.name.toLowerCase() === dimensionName.toLowerCase())) {
    return "No visible dimension matches that name.";
  }
  const attributeName = input.attribute?.trim().toLowerCase();
  if (
    attributeName &&
    !fields.some((field) => field.key.toLowerCase() === attributeName || field.friendlyName.toLowerCase() === attributeName)
  ) {
    return "No visible attribute matches that name.";
  }
  const scoped = fields.filter((field) => {
    if (dimensionName && field.category.name.toLowerCase() !== dimensionName.toLowerCase()) return false;
    if (!attributeName) return true;
    return field.key.toLowerCase() === attributeName || field.friendlyName.toLowerCase() === attributeName;
  });
  const foldedQuery = query.toLowerCase();
  const named = scoped.filter(
    (field) => field.friendlyName.toLowerCase().includes(foldedQuery) || field.key.toLowerCase().includes(foldedQuery),
  );
  const listIds = [...new Set(scoped.map((field) => field.choiceListId).filter((id): id is string => Boolean(id)))];
  const labelHits = listIds.length
    ? await prisma.choiceListItem.findMany({
        where: { listId: { in: listIds }, isActive: true, label: { contains: query, mode: "insensitive" } },
        select: { listId: true, value: true },
        take: 50,
      })
    : [];
  const checkboxIds = scoped
    .filter((field) => field.dataType === "CHECKBOX" && (foldedQuery === "no" || foldedQuery === checkboxCheckedText(field).toLowerCase()))
    .map((field) => field.id);
  const storeKeyIds = fields.filter((field) => field.isStoreKey).map((field) => field.id);
  const scopedIds = scoped.map((field) => field.id);
  const filters = [
    ...(scopedIds.length ? [{ fieldId: { in: scopedIds }, valueText: { contains: query, mode: "insensitive" as const } }] : []),
    ...(named.length ? [{ fieldId: { in: named.map((field) => field.id) } }] : []),
    ...labelHits.flatMap((hit) => {
      const ids = scoped.filter((field) => field.choiceListId === hit.listId).map((field) => field.id);
      return ids.length ? [{ fieldId: { in: ids }, valueText: { contains: hit.value } }] : [];
    }),
    ...(checkboxIds.length ? [{ fieldId: { in: checkboxIds }, valueBoolean: foldedQuery !== "no" }] : []),
    ...(storeKeyIds.length ? [{ fieldId: { in: storeKeyIds }, valueText: { contains: query, mode: "insensitive" as const } }] : []),
  ];
  if (!filters.length) return "No records match.";
  const matches = await prisma.fieldValue.findMany({
    where: { OR: filters },
    select: { locationId: true },
    distinct: ["locationId"],
    take: SEARCH_LIMIT,
  });
  // Text inside files on attributes in scope, so a question about a policy finds the document.
  const fileFieldIds = scoped.filter((field) => field.dataType === "FILE").map((field) => field.id);
  const fileHits = fileFieldIds.length ? await searchFileText(fileFieldIds, query) : [];
  const ids = [...new Set([...matches.map((row) => row.locationId), ...fileHits.map((hit) => hit.locationId)])].slice(0, SEARCH_LIMIT);
  const cards = await cardsFor(allFields, ids);
  if (!cards.length) return "No records match.";
  return cards
    .map((card) => {
      const recordId = card.split("\n")[0].slice("Record: ".length);
      const hits = fileHits.filter((hit) => hit.locationId === recordId);
      if (!hits.length) return card;
      return `${card}\nMatched inside files:\n${hits.map((hit) => `- ${hit.name} [file ${hit.id}]: "...${hit.snippet}..."`).join("\n")}`;
    })
    .join("\n\n");
}

/** Files whose text contains the query, with a short passage around the first match. */
async function searchFileText(fieldIds: string[], query: string) {
  await catchUpFileText(fieldIds);
  const rows = await prisma.$queryRaw<{ id: string; name: string; locationId: string; fieldId: string; snippet: string }[]>`
    SELECT f.id, f.name, f."locationId", f."fieldId",
           substring(f.text FROM greatest(1, strpos(lower(f.text), lower(${query})) - 160) FOR 400) AS snippet
    FROM "StoredFile" f
    JOIN "Location" l ON l.id = f."locationId" AND l."isActive"
    JOIN "FieldValue" v ON v."locationId" = f."locationId" AND v."fieldId" = f."fieldId" AND v."valueText" LIKE '%' || f.id || '/%'
    WHERE f."fieldId" = ANY(${fieldIds}) AND f.text ILIKE '%' || ${escapeLike(query)} || '%'
    ORDER BY f."createdAt" DESC
    LIMIT ${SEARCH_LIMIT}`;
  return rows.map((row) => ({ ...row, snippet: row.snippet.replace(/\s+/g, " ").trim() }));
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Characters returned per read_file call: long documents are read in parts. */
export const FILE_CHUNK = 40_000;

/**
 * The text of a file on a record this person can view. With find, the passages that mention it;
 * otherwise the text from offset, one part at a time.
 */
export async function readFile(ctx: AccessContext, input: { fileId: string; offset?: number; find?: string }) {
  const id = input.fileId.trim();
  if (!id) return "file_id is required.";
  const file = await visibleFile(ctx, id, { activeOnly: true });
  if (!file) return "No file with that id is visible.";
  const subject = (await subjectLabels([file.locationId])).get(file.locationId) ?? file.locationId;
  const header = `File: ${file.name}\nOn record: ${subject} (record ${file.locationId}), attribute ${file.field.friendlyName}`;
  const extracted = await fileText(file.id);
  if ("error" in extracted) return `${header}\n${extracted.error}`;
  const text = extracted.text;
  const find = input.find?.trim();
  if (find) {
    const lower = text.toLowerCase();
    const terms = [find.toLowerCase(), ...find.toLowerCase().split(/\s+/).filter((word) => word.length > 3)];
    const term = terms.find((candidate) => lower.includes(candidate));
    if (!term) return `${header}\nNo passage mentions "${find}". Read the file from offset 0 to see all of it (${text.length.toLocaleString("en-US")} characters).`;
    const passages: string[] = [];
    let at = lower.indexOf(term);
    let last = -1;
    while (at >= 0 && passages.length < 8) {
      if (at > last) {
        const start = Math.max(0, at - 1200);
        const end = Math.min(text.length, at + term.length + 1800);
        passages.push(`[offset ${start}]\n${text.slice(start, end)}`);
        last = end;
      }
      at = lower.indexOf(term, at + term.length);
    }
    return `${header}\nPassages mentioning "${term}" (${passages.length} shown). Read more with offset.\n\n${passages.join("\n\n...\n\n")}`;
  }
  const offset = Math.max(0, Math.min(Math.floor(input.offset ?? 0), text.length));
  const end = Math.min(text.length, offset + FILE_CHUNK);
  const more = end < text.length ? ` Call read_file again with offset ${end} for the rest.` : " This is the end of the file.";
  return `${header}\nCharacters ${offset.toLocaleString("en-US")} to ${end.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")}.${more}\n\n${text.slice(offset, end)}`;
}

export async function getRecord(ctx: AccessContext, id: string) {
  const recordId = id.trim();
  if (!recordId) return "id is required.";
  const location = await prisma.location.findUnique({ where: { id: recordId }, select: { id: true } });
  if (!location) return "No record with that id is visible.";
  const fields = await visibleFields(ctx);
  if (!fields.length) return "No record with that id is visible.";
  const cards = await cardsFor(fields, [location.id]);
  if (!cards[0]) return "No record with that id is visible.";
  const inbound = (await linkedFrom(location.id)).filter((link) => canSeeValue(ctx, link.fieldId, link.categoryId));
  if (!inbound.length) return cards[0];
  const lines = inbound.map((link) => `${link.recordType} ${link.label} (record ${link.locationId}) via ${link.attribute}`);
  return `${cards[0]}\nLinked from:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

export async function recentChanges(ctx: AccessContext, since: string) {
  const moment = new Date(since);
  if (Number.isNaN(moment.getTime())) return "since must be an ISO timestamp.";
  const rows = await prisma.fieldChange.findMany({
    where: { createdAt: { gte: moment } },
    include: { field: { include: { category: true } }, user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: CHANGE_LIMIT,
  });
  const visible = rows.filter((row) => canSeeValue(ctx, row.fieldId, row.field.categoryId));
  const labels = await subjectLabels(visible.map((row) => row.locationId));
  if (!visible.length) return "No changes since that time.";
  return visible
    .map((row) =>
      [
        row.createdAt.toISOString(),
        labels.get(row.locationId) || row.locationId,
        row.field.category.name,
        row.field.friendlyName,
        `${row.oldValue || "blank"} -> ${row.newValue || "blank"}`,
        row.user.name,
        row.locationId,
      ].join(" | "),
    )
    .join("\n");
}
