import type { FieldDefinition, FieldOption, FieldValue } from "@prisma/client";
import { displayDate, type DataTypeName, type FieldRules } from "@/lib/validators";

export type DefinedField = FieldDefinition & { options: FieldOption[] };

export function rulesFromField(field: DefinedField): FieldRules {
  return {
    dataType: field.dataType as DataTypeName,
    isRequired: field.isRequired,
    validationPattern: field.validationPattern,
    useRegex: field.useRegex,
    formatExample: field.formatExample,
    maxLength: field.maxLength,
    minValue: field.minValue == null ? null : Number(field.minValue),
    maxValue: field.maxValue == null ? null : Number(field.maxValue),
    negativeOk: field.negativeOk,
    decimalOk: field.decimalOk,
    is24Hour: field.is24Hour,
    minDate: field.minDate,
    maxDate: field.maxDate,
    multiple: field.multiple,
    options: field.options.map((option) => ({ label: option.label, value: option.value })),
  };
}

export function storedToInput(field: DefinedField, value: FieldValue | undefined): string {
  if (!value) return field.defaultValue || "";
  if (field.dataType === "CHECKBOX") return value.valueBoolean ? "1" : "0";
  if (field.dataType === "NUMERIC" && value.valueNumber != null) return Number(value.valueNumber).toString();
  if ((field.dataType === "DATE" || field.dataType === "DATETIME") && value.valueDateTime) {
    const iso = value.valueDateTime.toISOString();
    return field.dataType === "DATE" ? iso.slice(0, 10) : iso.slice(0, 16);
  }
  return value.valueText ?? "";
}

export function checkboxCheckedText(field: { checkboxLabel: string }) {
  return field.checkboxLabel.trim() || "Yes";
}

function withChoiceLabels(field: DefinedField, options?: { label: string; value: string }[]): DefinedField {
  if (!options) return field;
  return {
    ...field,
    options: options.map((option, index) => ({
      id: String(index),
      fieldId: field.id,
      label: option.label,
      value: option.value,
      parentValues: "",
      isDefault: false,
      sortOrder: index,
    })),
  };
}

export function displayStored(
  field: DefinedField,
  value: FieldValue | undefined,
  options?: { label: string; value: string }[],
): string {
  if (!value) return "";
  const present = value.valueText != null || value.valueNumber != null || value.valueBoolean != null || value.valueDateTime != null;
  if (!present) return "";
  return storedToDisplay(withChoiceLabels(field, options), value);
}

export function displayRaw(field: DefinedField, raw: string, options?: { label: string; value: string }[]): string {
  const stored = inputToStored(field, raw);
  return displayStored(
    field,
    {
      id: "draft",
      locationId: "draft",
      fieldId: field.id,
      updatedAt: new Date(),
      valueText: stored.valueText,
      valueNumber: stored.valueNumber as FieldValue["valueNumber"],
      valueBoolean: stored.valueBoolean,
      valueDateTime: stored.valueDateTime,
    },
    options,
  );
}

export function storedToDisplay(field: DefinedField, value: FieldValue | undefined): string {
  const raw = storedToInput(field, value);
  if (!raw) return "";
  if (field.dataType === "CHECKBOX") return raw === "1" ? checkboxCheckedText(field) : "No";
  if (field.dataType === "DATE") return displayDate(raw);
  if (field.dataType === "RADIO" || field.dataType === "DROPDOWN" || field.dataType === "RECORD_LINK") {
    const selected = raw.split("|");
    return selected
      .map((item) => field.options.find((option) => option.value === item)?.label ?? item)
      .join(", ");
  }
  return raw;
}

export function inputToStored(field: DefinedField, raw: string) {
  const value = raw.trim();
  if (!value && field.dataType !== "CHECKBOX") {
    return { valueText: null, valueNumber: null, valueBoolean: null, valueDateTime: null };
  }
  if (field.dataType === "CHECKBOX") {
    return { valueText: null, valueNumber: null, valueBoolean: value === "1", valueDateTime: null };
  }
  if (field.dataType === "NUMERIC") {
    return {
      valueText: value,
      valueNumber: value,
      valueBoolean: null,
      valueDateTime: null,
    };
  }
  if (field.dataType === "DATE") {
    return {
      valueText: value,
      valueNumber: null,
      valueBoolean: null,
      valueDateTime: new Date(`${value}T12:00:00Z`),
    };
  }
  if (field.dataType === "DATETIME") {
    return {
      valueText: value,
      valueNumber: null,
      valueBoolean: null,
      valueDateTime: new Date(value),
    };
  }
  return { valueText: value, valueNumber: null, valueBoolean: null, valueDateTime: null };
}

export function localDateInput(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultInput(field: DefinedField): string {
  if (field.dataType === "RADIO" || field.dataType === "DROPDOWN") {
    const defaults = field.options.filter((option) => option.isDefault).map((option) => option.value);
    if (field.multiple) return defaults.join("|");
    return defaults[0] ?? field.defaultValue ?? "";
  }
  if (field.dataType === "CHECKBOX") return field.defaultValue === "1" ? "1" : "0";
  return field.defaultValue ?? "";
}
