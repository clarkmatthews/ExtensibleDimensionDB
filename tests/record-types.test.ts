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

  it("links several records even when the attribute carries a length limit", async () => {
    const ids = Array.from({ length: 5 }, (_, index) => `cmv1i8wxf000pvl7daeyw${index}xyz`);
    const rules = { ...linkRules, multiple: true, maxLength: 50, options: ids.map((id) => ({ label: id, value: id })) };
    expect(await validateValue(rules, ids.join("|"))).toBeNull();
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

describe("workflows and record types", async () => {
  const { appliesToRecordType } = await import("@/lib/workflow");
  const category = (recordTypeId: string) => ({ category: { recordTypeId } });
  const trigger = (recordTypeId: string) => ({ field: { category: { recordTypeId } } });

  it("applies a workflow limited to dimensions only to the types that own them", () => {
    expect(appliesToRecordType({ categories: [category("location")], triggers: [] }, "location")).toBe(true);
    expect(appliesToRecordType({ categories: [category("location")], triggers: [] }, "vendor")).toBe(false);
  });

  it("applies a workflow with trigger attributes only to their types", () => {
    expect(appliesToRecordType({ categories: [], triggers: [trigger("location")] }, "vendor")).toBe(false);
    expect(appliesToRecordType({ categories: [], triggers: [trigger("vendor")] }, "vendor")).toBe(true);
  });

  it("applies an unscoped workflow to every type", () => {
    expect(appliesToRecordType({ categories: [], triggers: [] }, "vendor")).toBe(true);
  });
});
