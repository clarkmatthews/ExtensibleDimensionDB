import { parseCsv, unguardCell } from "@/lib/csv";
import type { AccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  canUpdateField,
  choicesFor,
  planSave,
  type LoadedField,
  type SaveContext,
} from "@/lib/record-save";
import type { Choice } from "@/lib/validators";
import { checkboxCheckedText, displayRaw, displayStored } from "@/lib/values";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_REPORTED_ERRORS = 200;

export type ColumnStatus = "matched" | "identifier" | "unknown" | "ambiguous" | "read-only" | "automatic";

export type ImportColumn = { index: number; header: string; status: ColumnStatus; fieldId?: string; field?: string };

export type RowPlan = {
  row: number;
  label: string;
  action: "create" | "update" | "unchanged" | "error";
  locationId: string;
  messages: string[];
};

export type ImportSummary = {
  columns: ImportColumn[];
  totalRows: number;
  create: number;
  update: number;
  unchanged: number;
  errors: number;
  errorRows: RowPlan[];
  identifier: string | null;
  fatal?: string;
};

export type ApplyResult = { created: number; updated: number; unchanged: number; failed: { row: number; message: string }[] };

function fold(value: string) {
  return value.trim().toLowerCase();
}

/** Matches CSV headers to attributes by key or display name, case-insensitively. */
export function matchColumns(headers: string[], fields: LoadedField[], access: AccessContext): ImportColumn[] {
  return headers.map((header, index) => {
    const wanted = fold(header);
    const byKey = fields.filter((field) => fold(field.key) === wanted);
    const byName = fields.filter((field) => fold(field.friendlyName) === wanted || fold(`${field.category.name}: ${field.friendlyName}`) === wanted);
    const candidates = byKey.length ? byKey : byName;
    if (!wanted || candidates.length === 0) return { index, header, status: "unknown" as const };
    if (candidates.length > 1) return { index, header, status: "ambiguous" as const };
    const field = candidates[0];
    const base = { index, header, fieldId: field.id, field: `${field.category.name}: ${field.friendlyName}` };
    if (field.isCreatedDate) return { ...base, status: "automatic" as const };
    if (!canUpdateField(access, field)) return { ...base, status: field.isStoreKey ? ("identifier" as const) : ("read-only" as const) };
    return { ...base, status: field.isStoreKey ? ("identifier" as const) : ("matched" as const) };
  });
}

function matchChoice(token: string, choices: Choice[]) {
  const wanted = fold(token);
  return choices.find((choice) => fold(choice.value) === wanted) ?? choices.find((choice) => fold(choice.label) === wanted);
}

/**
 * Turns a cell, as people type it or as Export CSV writes it, into the form's input format:
 * choice labels become values, MM/DD/YYYY becomes YYYY-MM-DD, Yes/No becomes 1/0.
 * A value that cannot be converted is passed through so validation reports it.
 */
export function normalizeCell(field: LoadedField, cell: string, choices: Choice[]): string {
  const value = unguardCell(cell).trim();
  switch (field.dataType) {
    case "CHECKBOX": {
      const folded = fold(value);
      if (!folded || ["no", "false", "0", "n"].includes(folded)) return "0";
      if (["yes", "true", "1", "y", "x", fold(checkboxCheckedText(field))].includes(folded)) return "1";
      return value;
    }
    case "DATE": {
      const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
      if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
      return value;
    }
    case "NUMERIC":
      return value.replace(/,/g, "");
    case "DROPDOWN":
    case "RADIO": {
      if (!value) return "";
      if (!field.multiple) return matchChoice(value, choices)?.value ?? value;
      // Export joins several choices with ", "; the form stores them joined with "|".
      const tokens = value.includes("|") ? value.split("|") : value.split(",");
      return tokens
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => matchChoice(token, choices)?.value ?? token)
        .join("|");
    }
    default:
      return value;
  }
}

type PreparedRow = {
  row: number;
  label: string;
  locationId: string;
  values: Map<string, string>;
  messages: string[];
};

/** Reads the file, matches columns, finds existing records by identifier, and normalizes cells. */
async function prepare(csv: string, ctx: SaveContext, access: AccessContext) {
  const parsed = parseCsv(csv);
  const [headers = [], ...body] = parsed;
  const columns = matchColumns(headers, ctx.fields, access);
  const writable = columns.filter((column) => column.status === "matched" || (column.status === "identifier" && canWrite(column)));
  const identifierColumn = columns.find((column) => column.status === "identifier");
  const identifierField = identifierColumn ? ctx.fields.find((field) => field.id === identifierColumn.fieldId) : undefined;

  function canWrite(column: ImportColumn) {
    const field = ctx.fields.find((item) => item.id === column.fieldId);
    return Boolean(field && canUpdateField(access, field));
  }

  const identifiers = identifierColumn ? body.map((cells) => unguardCell(cells[identifierColumn.index] ?? "").trim()) : [];
  const existing = new Map<string, string>();
  if (identifierField && identifiers.some(Boolean)) {
    const rows = await prisma.fieldValue.findMany({
      where: { fieldId: identifierField.id, valueText: { in: [...new Set(identifiers.filter(Boolean))] }, location: { isActive: true } },
      select: { valueText: true, locationId: true },
    });
    for (const row of rows) if (row.valueText) existing.set(row.valueText, row.locationId);
  }

  const seen = new Map<string, number>();
  const prepared: PreparedRow[] = [];
  for (const [offset, cells] of body.entries()) {
    const rowNumber = offset + 2; // 1-based, after the header row
    const label = identifiers[offset] ?? "";
    const messages: string[] = [];
    if (label) {
      const first = seen.get(label);
      if (first) messages.push(`${identifierField?.friendlyName ?? "Identifier"} ${label} is also on row ${first}.`);
      else seen.set(label, rowNumber);
    }
    if (cells.length > headers.length) messages.push(`This row has ${cells.length} cells but the header has ${headers.length}.`);
    const locationId = label ? (existing.get(label) ?? "") : "";
    const stored = locationId ? await storedText(locationId) : new Map<string, string>();
    const values = new Map<string, string>();
    for (const column of writable) {
      const field = ctx.fields.find((item) => item.id === column.fieldId)!;
      const parent = field.parentFieldId ? ctx.fields.find((item) => item.id === field.parentFieldId) : undefined;
      const parentColumn = parent ? writable.find((item) => item.fieldId === parent.id) : undefined;
      // A child list's choices depend on the parent's value in the same row, or the stored one.
      const parentRaw = parent
        ? parentColumn
          ? normalizeCell(parent, cells[parentColumn.index] ?? "", await choicesFor(ctx, parent, ""))
          : (stored.get(parent.id) ?? "")
        : "";
      const choices = await choicesFor(ctx, field, parentRaw);
      values.set(field.id, normalizeCell(field, cells[column.index] ?? "", choices));
    }
    prepared.push({ row: rowNumber, label, locationId, values, messages });
  }
  return { columns, identifierField, prepared, rowCount: body.length };
}

async function storedText(locationId: string) {
  const rows = await prisma.fieldValue.findMany({ where: { locationId } });
  return new Map(rows.map((value) => [value.fieldId, value.valueText ?? ""]));
}

/** Validates every row without writing anything. */
export async function previewImport(csv: string, ctx: SaveContext, access: AccessContext): Promise<ImportSummary> {
  const empty: ImportSummary = { columns: [], totalRows: 0, create: 0, update: 0, unchanged: 0, errors: 0, errorRows: [], identifier: null };
  if (Buffer.byteLength(csv, "utf8") > MAX_IMPORT_BYTES) return { ...empty, fatal: "The file is larger than 5 MB. Split it into smaller files." };
  const { columns, identifierField, prepared, rowCount } = await prepare(csv, ctx, access);
  const summary: ImportSummary = { ...empty, columns, totalRows: rowCount, identifier: identifierField?.friendlyName ?? null };
  if (!columns.length) return { ...summary, fatal: "The file is empty." };
  if (rowCount > MAX_IMPORT_ROWS) return { ...summary, fatal: `The file has ${rowCount} rows. Import at most ${MAX_IMPORT_ROWS} at a time.` };
  if (!columns.some((column) => column.status === "matched" || column.status === "identifier")) {
    return { ...summary, fatal: "No column matches an attribute you can update. Use attribute keys or display names as headers." };
  }
  for (const item of prepared) {
    const plan = await planRow(item, ctx, access);
    if (plan.action === "error") {
      summary.errors += 1;
      if (summary.errorRows.length < MAX_REPORTED_ERRORS) summary.errorRows.push(plan);
    } else summary[plan.action] += 1;
  }
  return summary;
}

async function planRow(item: PreparedRow, ctx: SaveContext, access: AccessContext): Promise<RowPlan> {
  const base = { row: item.row, label: item.label, locationId: item.locationId };
  if (item.messages.length) return { ...base, action: "error", messages: item.messages };
  const stored = item.locationId ? await storedText(item.locationId) : new Map<string, string>();
  const plan = await planSave(ctx, access, item.locationId, (field) => item.values.get(field.id), stored);
  if (!plan.ok) return { ...base, action: "error", messages: plan.errors };
  if (!item.locationId) return { ...base, action: "create", messages: [] };
  const current = await prisma.fieldValue.findMany({ where: { locationId: item.locationId } });
  const changes = plan.writes.some((write) => {
    const previous = current.find((value) => value.fieldId === write.field.id);
    return displayStored(write.field, previous, write.options) !== displayRaw(write.field, write.raw, write.options);
  });
  return { ...base, action: changes ? "update" : "unchanged", messages: [] };
}

/** Prepares rows for applying; the caller saves each one with saveRecord. */
export async function rowsToApply(csv: string, ctx: SaveContext, access: AccessContext) {
  const { prepared } = await prepare(csv, ctx, access);
  return prepared;
}
