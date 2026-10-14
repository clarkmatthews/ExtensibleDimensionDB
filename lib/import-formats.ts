import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { parseCsv } from "@/lib/csv";
import { decodeXml } from "@/lib/file-text";

/**
 * Import accepts CSV, Excel (.xlsx), JSON, and XML. Every format becomes the same table: a header
 * row of attribute keys or display names, then one row per record. The table is stored as CSV, so
 * matching, validation, preview, and apply are identical whatever the file was.
 */
export const IMPORT_FORMATS = [".csv", ".xlsx", ".json", ".xml"] as const;

export type Table = string[][];
export type ReadResult = { table: Table; format: string; note?: string } | { error: string };

/** Uncompressed size allowed inside an .xlsx, so a small zip cannot expand into gigabytes. */
const MAX_XLSX_EXPANDED = 100 * 1024 * 1024;

export function importExtension(name: string) {
  const match = /\.[a-z0-9]+$/i.exec(name.trim());
  return match ? match[0].toLowerCase() : "";
}

export async function readImportFile(name: string, bytes: Uint8Array): Promise<ReadResult> {
  const extension = importExtension(name);
  try {
    switch (extension) {
      case ".csv":
        return { table: parseCsv(new TextDecoder("utf-8").decode(bytes)), format: "CSV" };
      case ".xlsx":
        return readXlsx(bytes);
      case ".json":
        return readJson(new TextDecoder("utf-8").decode(bytes));
      case ".xml":
        return readXml(new TextDecoder("utf-8").decode(bytes));
      default:
        return { error: `Choose a CSV, Excel (.xlsx), JSON, or XML file. ${extension || "This file"} cannot be imported.` };
    }
  } catch (error) {
    return { error: `The file could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Writes a table as CSV that parseCsv reads back exactly. */
export function tableToCsv(table: Table) {
  return table.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

/** Rows padded to the header's width, with fully empty rows dropped. */
function tidyTable(header: string[], rows: string[][]): Table {
  const width = header.length;
  return [header, ...rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")).filter((row) => row.some((cell) => cell.trim()))];
}

/** Turns a JSON or XML value into a cell: lists join with "|", like multiple choices in the form. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join("|");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Builds a table from records, with columns in the order they first appear. */
function tableFromRecords(records: Record<string, unknown>[]): Table {
  const header: string[] = [];
  for (const record of records) for (const key of Object.keys(record)) if (!header.includes(key)) header.push(key);
  return tidyTable(header, records.map((record) => header.map((key) => cellText(record[key]))));
}

// ---------- JSON ----------

const RECORD_LISTS = ["dimensions", "records", "items", "data", "rows", "results"];

/**
 * An array of objects, or an object holding one (such as the share API's `dimensions`). An object
 * whose attributes sit under `values`, as the share API writes them, is read from `values`.
 */
function readJson(text: string): ReadResult {
  const parsed: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  let list: unknown = parsed;
  if (!Array.isArray(parsed) && parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;
    const named = RECORD_LISTS.find((key) => Array.isArray(object[key]));
    const arrays = Object.keys(object).filter((key) => Array.isArray(object[key]));
    list = named ? object[named] : arrays.length === 1 ? object[arrays[0]] : [object];
  }
  if (!Array.isArray(list)) return { error: "The JSON file needs a list of records, such as [{\"Vendor code\": \"ACME\", ...}]." };
  const records = list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!records.length) return { error: "The JSON file has no records. Use a list of objects, one per record, keyed by attribute." };
  const flat = records
    .map((record) => (record.values && typeof record.values === "object" && !Array.isArray(record.values) ? (record.values as Record<string, unknown>) : record))
    .filter((record) => Object.keys(record).length > 0);
  if (!flat.length) return { error: "The JSON file has no records. Use a list of objects, one per record, keyed by attribute." };
  return { table: tableFromRecords(flat), format: "JSON" };
}

// ---------- XML ----------

type XmlNode = Record<string, unknown>;

const isNode = (value: unknown): value is XmlNode => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Every element as a list, so repeated and single elements look the same. */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (_name, _path, _isLeaf, isAttribute) => !isAttribute,
});

function xmlText(value: unknown): string {
  if (Array.isArray(value)) return value.map(xmlText).filter(Boolean).join("|");
  if (isNode(value)) return xmlText(value["#text"] ?? "");
  return value == null ? "" : String(value);
}

const childKeys = (node: XmlNode) => Object.keys(node).filter((key) => !key.startsWith("@_") && key !== "#text");

/**
 * The records: a repeated element whose children are all simple fields (text, or <value key="…">),
 * such as <vendor> under <vendors> or <dimension> in the share API's XML. Elements made of keyed
 * <value> fields come first, then the longest list. Attribute-only elements, as in
 * <vendor code="A" name="Alpha"/>, count when nothing else does.
 */
function findRecords(root: XmlNode): XmlNode[] {
  const isLeaf = (item: unknown) => !isNode(item) || childKeys(item).length === 0;
  const fieldsOnly = (item: XmlNode) => childKeys(item).length > 0 && childKeys(item).every((key) => (item[key] as unknown[]).every(isLeaf));
  const keyed = (item: XmlNode) => childKeys(item).some((key) => (item[key] as unknown[]).some((child) => isNode(child) && typeof child["@_key"] === "string"));
  const lists: XmlNode[][] = [];
  const visit = (node: XmlNode) => {
    for (const key of childKeys(node)) {
      const items = (node[key] as unknown[]).filter(isNode);
      lists.push(items);
      for (const item of items) visit(item);
    }
  };
  visit(root);
  const pick = (accept: (item: XmlNode) => boolean) =>
    lists.map((items) => items.filter(accept)).filter((items) => items.length).sort((a, b) => b.length - a.length)[0] ?? [];
  const byKey = pick((item) => fieldsOnly(item) && keyed(item));
  if (byKey.length) return byKey;
  const byFields = pick(fieldsOnly);
  if (byFields.length) return byFields;
  return pick((item) => childKeys(item).length === 0 && Object.keys(item).some((name) => name.startsWith("@_")));
}

/** One record: attributes and child elements by name; <value key="…"> elements by their key. */
function xmlRecord(node: XmlNode): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) record[key.slice(2)] = value;
  }
  for (const key of childKeys(node)) {
    const items = node[key] as unknown[];
    const keyed = items.filter((item) => isNode(item) && typeof item["@_key"] === "string") as XmlNode[];
    if (keyed.length === items.length && keyed.length) {
      for (const item of keyed) record[String(item["@_key"])] = xmlText(item);
      continue;
    }
    record[key] = xmlText(items);
  }
  return record;
}

function readXml(text: string): ReadResult {
  const parsed = xmlParser.parse(text) as XmlNode;
  const records = findRecords(parsed);
  if (!records.length) return { error: "The XML file has no records. Use one repeated element per record, with a child element for each attribute." };
  return { table: tableFromRecords(records.map(xmlRecord)), format: "XML" };
}

// ---------- Excel ----------

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "";

function columnIndex(reference: string) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? "";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/** Built-in Excel number formats that show dates or times. */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export function isDateFormat(code: string) {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

/** An Excel date serial as the form's input: YYYY-MM-DD, HH:MM, or YYYY-MM-DDTHH:MM. */
export function excelDate(serial: number, date1904 = false) {
  const days = Math.floor(serial);
  const minutes = Math.round((serial - days) * 24 * 60);
  const base = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 86_400_000 : 0);
  const moment = new Date(base + days * 86_400_000 + minutes * 60_000);
  const iso = moment.toISOString();
  if (days === 0 && !date1904) return iso.slice(11, 16);
  return minutes === 0 ? iso.slice(0, 10) : iso.slice(0, 16);
}

function readXlsx(bytes: Uint8Array): ReadResult {
  let expanded = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      expanded += file.originalSize;
      if (expanded > MAX_XLSX_EXPANDED) throw new Error("the workbook expands to more than 100 MB");
      return /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(file.name);
    },
  });
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : "");
  const workbook = read("xl/workbook.xml");
  if (!workbook) return { error: "This is not an Excel workbook (.xlsx). Older .xls files need saving as .xlsx or CSV first." };
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);

  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXml([...match[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")),
  );

  const styles = read("xl/styles.xml");
  const customFormats = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((match) => [Number(attribute(match[0], "numFmtId")), decodeXml(attribute(match[0], "formatCode"))]));
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const dateStyles = [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((match) => {
    const id = Number(attribute(match[0], "numFmtId"));
    return DATE_FORMAT_IDS.has(id) || isDateFormat(customFormats.get(id) ?? "");
  });

  // The first sheet, as the workbook lists it.
  const rels = read("xl/_rels/workbook.xml.rels");
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0] ?? "";
  const sheetName = decodeXml(attribute(firstSheet, "name"));
  const relId = attribute(firstSheet, "r:id");
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => match[0]).find((tag) => attribute(tag, "Id") === relId);
  const path = target ? `xl/${attribute(target, "Target").replace(/^\/?xl\//, "")}` : "xl/worksheets/sheet1.xml";
  const sheet = read(path);
  if (!sheet) return { error: "The workbook's first sheet could not be found." };

  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const cells: string[] = [];
    let next = 0;
    for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = ` ${cell[1]}`;
      const reference = attribute(tag, "r");
      const index = reference ? columnIndex(reference) : next;
      next = index + 1;
      const type = attribute(tag, "t");
      const inner = cell[2] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = decodeXml([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join(""));
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (type === "str") value = decodeXml(raw);
      else if (type === "e") value = "";
      else if (raw !== "") {
        const number = Number(raw);
        const style = Number(attribute(tag, "s") || 0);
        value = Number.isFinite(number) ? (dateStyles[style] ? excelDate(number, date1904) : String(number)) : decodeXml(raw);
      }
      cells[index] = value;
    }
    rows.push(Array.from(cells, (value) => value ?? ""));
  }
  const filled = rows.filter((row) => row.some((cell) => cell.trim()));
  if (!filled.length) return { error: `The sheet "${sheetName || "1"}" is empty.` };
  const [header, ...body] = filled;
  return {
    table: tidyTable(header.map((cell) => cell.trim()), body),
    format: "Excel",
    note: (workbook.match(/<sheet\b/g)?.length ?? 1) > 1 ? `Read the first sheet, "${sheetName}".` : undefined,
  };
}
