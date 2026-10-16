import type { Table } from "@/lib/import-formats";
import type { AccessContext } from "@/lib/permissions";
import { canUpdateField, choicesFor, loadSaveContext, type LoadedField } from "@/lib/record-save";
import { checkboxCheckedText } from "@/lib/values";

export { TABLE_FORMATS as SAMPLE_FORMATS, renderTable as renderSample, type TableFormat as SampleFormat } from "@/lib/table-export";

/** A value of the right shape for each type, used when an attribute has no format example. */
function typeExample(field: LoadedField) {
  switch (field.dataType) {
    case "NUMERIC":
      return field.decimalOk ? "12.50" : "12";
    case "DATE":
      return "2026-01-31";
    case "DATETIME":
      return "2026-01-31T09:30";
    case "TIME":
      return field.is24Hour ? "09:30" : "9:30 AM";
    case "CHECKBOX":
      return checkboxCheckedText(field);
    case "ZIPCODE":
      return "90012";
    case "EMAIL":
      return "name@example.com";
    case "PHONE":
      return "(213) 555-0123";
    case "ADDRESS":
      return "123 Main St";
    case "COORDINATE":
      return "34.0522, -118.2437";
    case "BIG_TEXT":
      return `Notes for ${field.friendlyName.toLowerCase()}`;
    default:
      return `Example ${field.friendlyName.toLowerCase()}`;
  }
}

/**
 * The columns a person can import for a record type (the unique identifier, and every attribute
 * they can update except files and the created date), with one example row. Headers are display
 * names; a name shared by two dimensions is written "Dimension: Name", which import also accepts.
 */
export async function sampleTable(access: AccessContext, recordTypeId: string): Promise<Table> {
  const ctx = await loadSaveContext(recordTypeId, access);
  const fields = ctx.fields.filter(
    (field) => field.dataType !== "FILE" && !field.isCreatedDate && (field.isStoreKey || canUpdateField(access, field)),
  );
  fields.sort((a, b) => Number(b.isStoreKey) - Number(a.isStoreKey));
  const counts = new Map<string, number>();
  for (const field of fields) counts.set(field.friendlyName.toLowerCase(), (counts.get(field.friendlyName.toLowerCase()) ?? 0) + 1);
  const header = fields.map((field) => ((counts.get(field.friendlyName.toLowerCase()) ?? 0) > 1 ? `${field.category.name}: ${field.friendlyName}` : field.friendlyName));

  // Choice values are needed for lists that follow another list, so they are kept beside the labels.
  const rawValues = new Map<string, string>();
  const row: string[] = [];
  for (const field of fields) {
    let shown = field.formatExample || field.defaultValue || "";
    if (field.dataType === "DROPDOWN" || field.dataType === "RADIO" || field.dataType === "RECORD_LINK") {
      const parent = field.parentFieldId ? ctx.fields.find((item) => item.id === field.parentFieldId) : undefined;
      const choices = await choicesFor(ctx, field, parent ? (rawValues.get(parent.id) ?? "") : "");
      const picked = choices.slice(0, field.multiple ? 2 : 1);
      if (picked.length) {
        rawValues.set(field.id, picked.map((choice) => choice.value).join("|"));
        shown = picked.map((choice) => choice.label).join("|");
      } else if (!shown) {
        shown = field.dataType === "RECORD_LINK" ? "Identifier of a linked record" : "";
      }
    }
    row.push(shown || typeExample(field));
  }
  return [header, row];
}

