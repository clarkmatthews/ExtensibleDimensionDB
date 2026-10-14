import { strToU8, zipSync } from "fflate";
import { tableToCsv, type Table } from "@/lib/import-formats";

/** The file formats tables are written in, for exports and import samples. */
export const TABLE_FORMATS = {
  csv: { label: "CSV", type: "text/csv; charset=utf-8" },
  xlsx: { label: "Excel", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  json: { label: "JSON", type: "application/json; charset=utf-8" },
  xml: { label: "XML", type: "application/xml; charset=utf-8" },
} as const;

export type TableFormat = keyof typeof TABLE_FORMATS;

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

/**
 * A table (header row first) as a file. With guardFormulas, CSV cells that start with = + - or @
 * get a leading apostrophe so a spreadsheet does not run them; import removes it again.
 */
export function renderTable(table: Table, format: TableFormat, sheetName: string, options: { guardFormulas?: boolean } = {}): Uint8Array {
  if (format === "xlsx") return xlsxBytes(table, sheetName);
  if (format === "json") return strToU8(`${JSON.stringify(asRecords(table), null, 2)}\n`);
  if (format === "xml") {
    const records = asRecords(table)
      .map((record) => `  <record>\n${Object.entries(record).map(([key, value]) => `    <value key="${xmlEscape(key)}">${xmlEscape(value)}</value>`).join("\n")}\n  </record>`)
      .join("\n");
    return strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<records>\n${records}\n</records>\n`);
  }
  const guarded = options.guardFormulas ? table.map((row) => row.map((cell) => (/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell))) : table;
  // A byte order mark helps Excel read UTF-8 CSV.
  return strToU8(`\uFEFF${tableToCsv(guarded)}\r\n`);
}
