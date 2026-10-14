import { describe, expect, it } from "vitest";
import { acceptedTypes, cleanFileName, contentMatches, fileNames, fileToken, normalizeFileTypes, parseFileTokens, servingHeaders, uploadError } from "@/lib/files";

const pdf = new TextEncoder().encode("%PDF-1.7\n...");
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

describe("file attribute values", () => {
  it("round-trips id and name, and shows names", () => {
    const raw = [fileToken({ id: "f1", name: "Lease 2026.pdf" }), fileToken({ id: "f2", name: "a|b/c.docx" })].join("|");
    expect(parseFileTokens(raw)).toEqual([{ id: "f1", name: "Lease 2026.pdf" }, { id: "f2", name: "c.docx" }]);
    expect(fileNames(raw)).toBe("Lease 2026.pdf, c.docx");
  });

  it("cleans names: no folders, separators, or control characters", () => {
    expect(cleanFileName("C:\\Users\\me\\report|v2.pdf")).toBe("report-v2.pdf");
    expect(cleanFileName(`${"x".repeat(300)}.pdf`)).toHaveLength(200);
  });

  it("normalizes accepted types and rejects unknown ones", () => {
    expect(normalizeFileTypes("PDF, .docx .pdf")).toEqual({ value: ".pdf,.docx" });
    expect(normalizeFileTypes(".pdf,.exe").error).toMatch(/Unsupported file type \.exe/);
    expect(acceptedTypes({ fileTypes: "" })).toContain(".docx");
  });
});

describe("uploads", () => {
  const field = { fileTypes: ".pdf,.docx", friendlyName: "Contract" };
  it("accepts a real PDF or Word file", () => {
    expect(uploadError(field, "lease.pdf", pdf)).toBeNull();
    expect(uploadError(field, "lease.docx", zip)).toBeNull();
  });
  it("refuses other types, renamed files, and empty files", () => {
    expect(uploadError(field, "photo.png", pdf)).toMatch(/not an accepted type/);
    expect(uploadError(field, "lease.pdf", zip)).toMatch(/does not look like a \.pdf/);
    expect(uploadError(field, "lease.pdf", new Uint8Array())).toMatch(/empty/);
    expect(contentMatches(".txt", new Uint8Array([65, 0, 66]))).toBe(false);
  });
  it("opens PDFs in the browser and downloads Word files", () => {
    expect(servingHeaders("lease.pdf", false)["Content-Disposition"]).toMatch(/^inline/);
    expect(servingHeaders("lease.pdf", true)["Content-Disposition"]).toMatch(/^attachment/);
    expect(servingHeaders("Lease é.docx", false)).toMatchObject({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="Lease _.docx"; filename*=UTF-8''Lease%20%C3%A9.docx`,
    });
  });
});
