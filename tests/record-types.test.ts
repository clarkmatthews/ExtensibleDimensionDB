import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => null }));

import { isChoiceType } from "@/lib/field-types";
import { validateValue, type FieldRules } from "@/lib/validators";
import { storedToDisplay, type DefinedField } from "@/lib/values";

const linkRules: FieldRules = {
  dataType: "RECORD_LINK",
  isRequired: false,
  validationPattern: "",
  useRegex: false,
  formatExample: "",
  maxLength: null,
  minValue: null,
  maxValue: null,
  negativeOk: false,
  decimalOk: false,
  is24Hour: true,
  minDate: "",
  maxDate: "",
  multiple: false,
  options: [
    { label: "ACME-01", value: "rec_acme" },
    { label: "BOLT-07", value: "rec_bolt" },
  ],
};

describe("record links", () => {
  it("is a choice type", () => {
    expect(isChoiceType("RECORD_LINK")).toBe(true);
    expect(isChoiceType("TEXT")).toBe(false);
  });

  it("accepts only active records of the linked type", async () => {
    expect(await validateValue(linkRules, "rec_acme")).toBeNull();
    expect(await validateValue(linkRules, "rec_gone")).toMatch(/active record/);
    expect(await validateValue({ ...linkRules, multiple: true }, "rec_acme|rec_bolt")).toBeNull();
    expect(await validateValue({ ...linkRules, multiple: true }, "rec_acme|rec_gone")).toMatch(/active record/);
  });

  it("displays the linked records' labels, not their ids", () => {
    const field = {
      id: "f",
      dataType: "RECORD_LINK",
      checkboxLabel: "",
      defaultValue: "",
      options: linkRules.options.map((option, index) => ({ ...option, id: String(index), fieldId: "f", parentValues: "", isDefault: false, sortOrder: index })),
    } as unknown as DefinedField;
    const stored = { valueText: "rec_acme|rec_bolt", valueNumber: null, valueBoolean: null, valueDateTime: null } as never;
    expect(storedToDisplay(field, stored)).toBe("ACME-01, BOLT-07");
  });
});
