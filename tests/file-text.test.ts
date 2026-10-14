import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decodeXml, extractFileText } from "@/lib/file-text";

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])));

describe("reading text from files", () => {
  it("decodes XML entities", () => {
    expect(decodeXml("Fish &amp; chips &lt;b&gt; &#8217; &#x2014;")).toBe("Fish & chips <b> ’ —");
  });

  it("reads Word paragraphs with tabs and breaks, then headers", async () => {
    const result = await extractFileText("h.docx", zip({
      "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Notice period</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Two weeks </w:t></w:r><w:r><w:tab/><w:t>&amp; final pay</w:t><w:br/><w:t>next line</w:t></w:r></w:p></w:body></w:document>',
      "word/header1.xml": "<w:hdr><w:p><w:r><w:t>Company handbook</w:t></w:r></w:p></w:hdr>",
    }));
    expect(result).toEqual({ text: "Notice period\nTwo weeks \t& final pay\nnext line\n\nCompany handbook" });
  });

  it("reads PowerPoint slides in order with notes", async () => {
    const result = await extractFileText("d.pptx", zip({
      "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>",
      "ppt/notesSlides/notesSlide2.xml": "<p:notes><a:p><a:r><a:t>Say hello</a:t></a:r></a:p></p:notes>",
    }));
    expect("text" in result && result.text).toBe("--- Slide 2 ---\nSecond\nNotes:\nSay hello\n\n--- Slide 10 ---\nTenth");
  });

  it("reads Excel sheets by name with shared and inline strings", async () => {
    const result = await extractFileText("p.xlsx", zip({
      "xl/workbook.xml": '<workbook><sheets><sheet name="Prices &amp; Items" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1" Type="x"/></Relationships>',
      "xl/sharedStrings.xml": "<sst><si><t>Item</t></si><si><r><t>Pri</t></r><r><t>ce</t></r></si></sst>",
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Bread</t></is></c><c r="B2"><v>3.5</v></c></row></sheetData></worksheet>',
    }));
    expect("text" in result && result.text).toBe("--- Sheet: Prices & Items ---\nItem\tPrice\nBread\t3.5");
  });

  it("explains files it cannot read", async () => {
    expect(await extractFileText("photo.png", new Uint8Array([1]))).toEqual({ error: "Text cannot be read from .png files. Open the file to view it." });
    expect("error" in (await extractFileText("broken.pdf", new Uint8Array([1, 2, 3])))).toBe(true);
  });
});
