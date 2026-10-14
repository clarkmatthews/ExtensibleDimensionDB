import { strFromU8, unzipSync } from "fflate";
import { extensionOf } from "@/lib/files";

/** Text kept per file. A long handbook fits; anything beyond is cut with a note. */
export const MAX_TEXT_CHARS = 2_000_000;

export type ExtractedText = { text: string } | { error: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function tidy(text: string) {
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > MAX_TEXT_CHARS ? `${cleaned.slice(0, MAX_TEXT_CHARS)}\n\n[Text cut at ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters.]` : cleaned;
}

/** Word: paragraphs from the body, then headers, footers, footnotes, and endnotes. */
export function docxText(files: Record<string, Uint8Array>) {
  const parts = ["word/document.xml", ...Object.keys(files).filter((name) => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(name)).sort()];
  return parts
    .filter((name) => files[name])
    .map((name) => {
      const xml = strFromU8(files[name]);
      return xml
        .split(/<\/w:p>/)
        .map((paragraph) =>
          // Text runs, tabs, and line breaks in document order.
          [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\/>/g)]
            .map((match) => (match[1] !== undefined ? decodeXml(match[1]) : match[0].startsWith("<w:tab") ? "\t" : "\n"))
            .join(""),
        )
        .join("\n");
    })
    .join("\n\n");
}

/** PowerPoint: each slide's text in slide order, then its notes. */
export function pptxText(files: Record<string, Uint8Array>) {
  const number = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  const slides = Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => number(a) - number(b));
  const textOf = (xml: string) =>
    xml
      .split(/<\/a:p>/)
      .map((paragraph) => decodeXml([...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join("")))
      .filter((line) => line.trim())
      .join("\n");
  return slides
    .map((name) => {
      const notes = files[`ppt/notesSlides/notesSlide${number(name)}.xml`];
      const body = textOf(strFromU8(files[name]));
      const noteText = notes ? textOf(strFromU8(notes)) : "";
      return [`--- Slide ${number(name)} ---`, body, noteText ? `Notes:\n${noteText}` : ""].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

/** Excel: each sheet as tab-separated rows, using the sheet names from the workbook. */
export function xlsxText(files: Record<string, Uint8Array>) {
  const shared = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
        decodeXml([...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")),
      )
    : [];
  const workbook = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  // Attributes can come in any order, so each is read on its own.
  const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => [attribute(match[0], "Id"), attribute(match[0], "Target")]));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((match) => {
    const target = (targets.get(attribute(match[0], "r:id")) ?? "").replace(/^\/?xl\//, "");
    return { name: decodeXml(attribute(match[0], "name")), path: `xl/${target}` };
  });
  const listed = sheets.length
    ? sheets
    : Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort().map((path, index) => ({ name: `Sheet ${index + 1}`, path }));
  return listed
    .filter((sheet) => files[sheet.path])
    .map((sheet) => {
      const xml = strFromU8(files[sheet.path]);
      const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
        [...row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
          .map((cell) => {
            const type = /\bt="([^"]+)"/.exec(cell[1])?.[1];
            const inner = cell[2] ?? "";
            if (type === "inlineStr") return decodeXml([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join(""));
            const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
            if (type === "s") return shared[Number(value)] ?? "";
            return decodeXml(value);
          })
          .join("\t")
          .replace(/\t+$/, ""),
      );
      return [`--- Sheet: ${sheet.name} ---`, ...rows.filter((row) => row.trim())].join("\n");
    })
    .join("\n\n");
}

async function pdfText(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((page, index) => `--- Page ${index + 1} ---\n${page}`).join("\n\n");
}

/**
 * The readable text of a stored file, for AI tools and search. PDFs need a text layer: a scanned
 * PDF without one has no text to read.
 */
export async function extractFileText(name: string, bytes: Uint8Array): Promise<ExtractedText> {
  const extension = extensionOf(name);
  try {
    let text = "";
    if (extension === ".pdf") text = await pdfText(bytes);
    else if (extension === ".txt" || extension === ".csv") text = new TextDecoder("utf-8").decode(bytes);
    else if (extension === ".docx" || extension === ".pptx" || extension === ".xlsx") {
      const files = unzipSync(bytes, { filter: (file) => file.name.endsWith(".xml") || file.name.endsWith(".rels") });
      text = extension === ".docx" ? docxText(files) : extension === ".pptx" ? pptxText(files) : xlsxText(files);
    } else {
      return { error: `Text cannot be read from ${extension || "this"} files. Open the file to view it.` };
    }
    const cleaned = tidy(text);
    if (!cleaned.replace(/--- (Page|Slide|Sheet)[^\n]*---/g, "").trim()) {
      return { error: extension === ".pdf" ? "This PDF has no text layer (it may be a scan), so there is no text to read." : "This file has no readable text." };
    }
    return { text: cleaned };
  } catch (error) {
    return { error: `The file's text could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}
