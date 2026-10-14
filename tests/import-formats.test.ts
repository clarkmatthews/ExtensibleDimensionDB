import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { excelDate, isDateFormat, readImportFile, tableToCsv } from "@/lib/import-formats";
import { renderSample } from "@/lib/import-samples";

const table = [
  ["Vendor code", "Vendor name", "Supplies", "Notes"],
  ["ACME", 'Acme "Fresh" Foods, Inc.', "Produce|Dairy", "Line one\nline two <b>&"],
];
const read = async (name: string, bytes: Uint8Array) => {
  const result = await readImportFile(name, bytes);
  if ("error" in result) throw new Error(result.error);
  return result;
};

describe("import formats", () => {
  it("round-trips every sample format to the same table", async () => {
    for (const format of ["csv", "xlsx", "json", "xml"] as const) {
      const result = await read(`sample.${format}`, renderSample(table, format, "Vendor"));
      expect(result.table, format).toEqual(table);
    }
  });

  it("stores any format as CSV that parses back exactly", () => {
    expect(parseCsv(tableToCsv(table))).toEqual(table);
  });

  it("reads the share API's JSON and XML", async () => {
    const json = JSON.stringify({ fields: [], dimensions: [{ id: "x1", recordType: "Vendor", values: { vendor_code: "ACME", vendor_name: "Acme" } }] });
    expect((await read("share.json", strToU8(json))).table).toEqual([["vendor_code", "vendor_name"], ["ACME", "Acme"]]);
    const xml = '<?xml version="1.0"?><share><fields><field key="vendor_code" name="Vendor code"><description/></field></fields><dimensions>' +
      '<dimension id="x1" recordType="Vendor"><value key="vendor_code">ACME</value><value key="vendor_name">Acme &amp; Co</value></dimension>' +
      '<dimension id="x2" recordType="Vendor"><value key="vendor_code">BOLT</value><value key="vendor_name"></value></dimension></dimensions></share>';
    expect((await read("share.xml", strToU8(xml))).table).toEqual([
      ["id", "recordType", "vendor_code", "vendor_name"],
      ["x1", "Vendor", "ACME", "Acme & Co"],
      ["x2", "Vendor", "BOLT", ""],
    ]);
  });

  it("reads plain JSON lists and XML with child elements", async () => {
    const json = JSON.stringify([{ code: "A", active: true, tags: ["x", "y"], count: 3 }, { code: "B", extra: null }]);
    expect((await read("list.json", strToU8(json))).table).toEqual([["code", "active", "tags", "count", "extra"], ["A", "true", "x|y", "3", ""], ["B", "", "", "", ""]]);
    const xml = "<vendors><vendor code=\"A\"><name>Alpha</name><city>LA</city></vendor><vendor code=\"B\"><name>Beta</name></vendor></vendors>";
    expect((await read("list.xml", strToU8(xml))).table).toEqual([["code", "name", "city"], ["A", "Alpha", "LA"], ["B", "Beta", ""]]);
  });

  it("explains files it cannot use", async () => {
    expect(await readImportFile("data.xls", new Uint8Array([1]))).toMatchObject({ error: expect.stringMatching(/\.xls cannot be imported/) });
    expect(await readImportFile("empty.json", strToU8("{}"))).toMatchObject({ error: expect.stringMatching(/no records/) });
  });
});

describe("Excel details", () => {
  it("turns date-formatted numbers into dates, and keeps sparse columns in place", async () => {
    const files = {
      "xl/workbook.xml": '<workbook><sheets><sheet name="Vendors" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/styles.xml": '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="mm/dd/yyyy hh:mm"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Code</t></is></c><c r="C1" t="inlineStr"><is><t>Opened</t></is></c><c r="D1" t="inlineStr"><is><t>Seen</t></is></c><c r="E1" t="inlineStr"><is><t>Open</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>A</t></is></c><c r="C2" s="1"><v>46053</v></c><c r="D2" s="2"><v>46053.5</v></c><c r="E2" t="b"><v>1</v></c></row></sheetData></worksheet>',
    };
    const result = await read("book.xlsx", zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)]))));
    expect(result.table).toEqual([["Code", "", "Opened", "Seen", "Open"], ["A", "", "2026-01-31", "2026-01-31T12:00", "TRUE"]]);
    expect(result.note).toBe('Read the first sheet, "Vendors".');
  });

  it("recognizes date formats and serials", () => {
    expect(isDateFormat("yyyy-mm-dd")).toBe(true);
    expect(isDateFormat('0.00" days"')).toBe(false);
    expect(isDateFormat("[Red]0.00")).toBe(false);
    expect(excelDate(0.75)).toBe("18:00");
  });
});

describe("export", () => {
  it("guards formulas in CSV exports, and import removes the guard", async () => {
    const { renderTable } = await import("@/lib/table-export");
    const { unguardCell } = await import("@/lib/csv");
    const csv = new TextDecoder().decode(renderTable([["Name"], ["=HYPERLINK(1)"]], "csv", "x", { guardFormulas: true }));
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    const back = await readImportFile("x.csv", strToU8(csv));
    expect("table" in back && unguardCell(back.table[1][0])).toBe("=HYPERLINK(1)");
  });
});
