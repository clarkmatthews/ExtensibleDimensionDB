import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => null }));

import { parseCsv, unguardCell } from "@/lib/csv";
import { matchColumns, normalizeCell } from "@/lib/import";
import type { AccessContext } from "@/lib/permissions";
import type { LoadedField } from "@/lib/record-save";
import { afterAttempt, isBlockedAddress, RETRY_MINUTES, signPayload, webhookUrlError } from "@/lib/webhooks";

function field(overrides: Partial<LoadedField>): LoadedField {
  return {
    id: "f1",
    key: "city",
    friendlyName: "City",
    categoryId: "c1",
    category: { id: "c1", name: "Core" },
    dataType: "TEXT",
    multiple: false,
    isStoreKey: false,
    isCreatedDate: false,
    checkboxLabel: "",
    options: [],
    ...overrides,
  } as unknown as LoadedField;
}

const admin = { user: { id: "u1", isAdmin: true } } as unknown as AccessContext;

describe("CSV parsing", () => {
  it("handles quotes, embedded commas and newlines, CRLF, and a byte order mark", () => {
    const text = '﻿Name,Notes\r\n"Mesa, Grill","Line one\nline ""two"""\r\n\r\nPlain,\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Notes"],
      ["Mesa, Grill", 'Line one\nline "two"'],
      ["Plain", ""],
    ]);
  });

  it("removes the formula guard that Export CSV adds", () => {
    expect(unguardCell("'-5")).toBe("-5");
    expect(unguardCell("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(unguardCell("O'Brien")).toBe("O'Brien");
  });
});

describe("import cell conversion", () => {
  it("accepts the formats Export CSV writes", () => {
    expect(normalizeCell(field({ dataType: "DATE" }), "03/07/2026", [])).toBe("2026-03-07");
    expect(normalizeCell(field({ dataType: "DATE" }), "2026-03-07", [])).toBe("2026-03-07");
    expect(normalizeCell(field({ dataType: "CHECKBOX", checkboxLabel: "Open" }), "Open", [])).toBe("1");
    expect(normalizeCell(field({ dataType: "CHECKBOX" }), "No", [])).toBe("0");
    expect(normalizeCell(field({ dataType: "CHECKBOX" }), "", [])).toBe("0");
    expect(normalizeCell(field({ dataType: "NUMERIC" }), "1,250.50", [])).toBe("1250.50");
  });

  it("maps choice labels to stored values, including several choices", () => {
    const choices = [
      { label: "Arizona", value: "AZ" },
      { label: "California", value: "CA" },
    ];
    expect(normalizeCell(field({ dataType: "DROPDOWN" }), "arizona", choices)).toBe("AZ");
    expect(normalizeCell(field({ dataType: "DROPDOWN" }), "CA", choices)).toBe("CA");
    expect(normalizeCell(field({ dataType: "DROPDOWN", multiple: true }), "Arizona, California", choices)).toBe("AZ|CA");
    expect(normalizeCell(field({ dataType: "DROPDOWN" }), "Texas", choices)).toBe("Texas");
  });

  it("maps linked records by their identifier to record ids", () => {
    const vendors = [
      { label: "ACME-01", value: "rec_acme" },
      { label: "BOLT-07", value: "rec_bolt" },
    ];
    expect(normalizeCell(field({ dataType: "RECORD_LINK" }), "acme-01", vendors)).toBe("rec_acme");
    expect(normalizeCell(field({ dataType: "RECORD_LINK", multiple: true }), "ACME-01, BOLT-07", vendors)).toBe("rec_acme|rec_bolt");
  });

  it("matches headers by key or display name and flags the rest", () => {
    const fields = [
      field({ id: "a", key: "store_code", friendlyName: "Store code", isStoreKey: true }),
      field({ id: "b", key: "phone_main", friendlyName: "Phone number" }),
      field({ id: "c", key: "phone_alt", friendlyName: "Phone number", category: { id: "c2", name: "Other" } as never, categoryId: "c2" }),
      field({ id: "d", key: "created", friendlyName: "Created", isCreatedDate: true }),
    ];
    const columns = matchColumns(["STORE_CODE", "phone_main", "Phone number", "Other: Phone number", "Created", "Nickname"], fields, admin);
    expect(columns.map((column) => column.status)).toEqual(["identifier", "matched", "ambiguous", "matched", "automatic", "unknown"]);
    expect(columns[3].fieldId).toBe("c");
  });
});

describe("webhooks", () => {
  it("signs the timestamp and body with HMAC-SHA256", () => {
    const body = JSON.stringify({ event: "record.updated" });
    const expected = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
    expect(signPayload("whsec_test", body, 1700000000)).toBe(`t=1700000000,v1=${expected}`);
  });

  it("blocks private, local, and metadata addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  });

  it("refuses unsafe URLs before any request is made", async () => {
    expect(await webhookUrlError("http://93.184.216.34/hook")).toMatch(/https/);
    expect(await webhookUrlError("https://169.254.169.254/latest")).toMatch(/private/);
    expect(await webhookUrlError("https://user:pass@93.184.216.34/")).toMatch(/password/);
    expect(await webhookUrlError("not a url")).toMatch(/full URL/);
    expect(await webhookUrlError("https://93.184.216.34/hook")).toBeNull();
  });

  it("retries with growing delays, then gives up", () => {
    const now = 1_000_000;
    const failure = { ok: false, status: 500, error: "x" };
    expect(afterAttempt(1, failure, now)).toMatchObject({ status: "PENDING", nextAttemptAt: new Date(now + 60_000) });
    expect(afterAttempt(RETRY_MINUTES.length, failure, now).status).toBe("PENDING");
    expect(afterAttempt(RETRY_MINUTES.length + 1, failure, now).status).toBe("FAILED");
    expect(afterAttempt(3, { ok: true, status: 200, error: "" }, now).status).toBe("DELIVERED");
  });
});
