import { strToU8, zipSync } from "fflate";
import { tableToCsv, type Table } from "@/lib/import-formats";
import type { AccessContext } from "@/lib/permissions";
import { canUpdateField, choicesFor, loadSaveContext, type LoadedField } from "@/lib/record-save";
import { checkboxCheckedText } from "@/lib/values";

export const SAMPLE_FORMATS = {
  csv: { label: "CSV", type: "text/csv; charset=utf-8" },
  xlsx: { label: "Excel", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  json: { label: "JSON", type: "application/json; charset=utf-8" },
  xml: { label: "XML", type: "application/xml; charset=utf-8" },
} as const;

export type SampleFormat = keyof typeof SAMPLE_FORMATS;

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
  const ctx = await loadSaveContext(recordTypeId);
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

const xmlEscape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The table as records keyed by column, for JSON and XML. */
function asRecords(table: Table) {
  const [header, ...rows] = table;
  return rows.map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ""])));
}

function columnName(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

/** A one-sheet workbook with a bold header row and the values as text. */
function xlsxBytes(table: Table, sheetName: string) {
  const rows = table
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`)
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const widths = table[0].map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(60, Math.max(12, ...table.map((row) => (row[index] ?? "").length + 2)))}" customWidth="1"/>`).join("");
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])));
}

/** The sample in one format, ready to download. */
export function renderSample(table: Table, format: SampleFormat, typeName: string): Uint8Array {
  if (format === "xlsx") return xlsxBytes(table, typeName);
  if (format === "json") return strToU8(`${JSON.stringify(asRecords(table), null, 2)}\n`);
  if (format === "xml") {
    const records = asRecords(table)
      .map((record) => `  <record>\n${Object.entries(record).map(([key, value]) => `    <value key="${xmlEscape(key)}">${xmlEscape(value)}</value>`).join("\n")}\n  </record>`)
      .join("\n");
    return strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<records>\n${records}\n</records>\n`);
  }
  // A byte order mark helps Excel read UTF-8 CSV.
  return strToU8(`﻿${tableToCsv(table)}\r\n`);
}
