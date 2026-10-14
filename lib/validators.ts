import { Worker } from "node:worker_threads";
import { type DataTypeName } from "@/lib/field-types";

export { DATA_TYPES, TYPE_LABELS, type DataTypeName } from "@/lib/field-types";

export type Choice = { label: string; value: string };

export type FieldRules = {
  dataType: DataTypeName;
  isRequired: boolean;
  validationPattern: string;
  useRegex: boolean;
  formatExample: string;
  maxLength: number | null;
  minValue: number | null;
  maxValue: number | null;
  negativeOk: boolean;
  decimalOk: boolean;
  is24Hour: boolean;
  minDate: string;
  maxDate: string;
  multiple: boolean;
  options: Choice[];
};

export function columnKeyError(key: string): string | null {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
    return "Attribute key must start with a letter and use only letters, numbers, and underscores.";
  }
  return null;
}

function testRegex(pattern: string, value: string, timeoutMs = 80): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require("node:worker_threads");
      try {
        const expression = new RegExp(workerData.pattern);
        parentPort.postMessage({ ok: true, match: expression.test(workerData.value) });
      } catch (error) {
        parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : "Invalid pattern" });
      }
      `,
      { eval: true, workerData: { pattern, value } },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Validation pattern took too long."));
    }, timeoutMs);
    worker.on("message", (message: { ok: boolean; match?: boolean; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (!message.ok) reject(new Error(message.error || "Invalid regular expression."));
      else resolve(Boolean(message.match));
    });
    worker.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function patternMatches(rules: FieldRules, value: string): Promise<boolean> {
  const pattern = rules.validationPattern.trim();
  if (!pattern) return true;
  return testRegex(pattern, value);
}

export async function compilePattern(rules: FieldRules): Promise<string | null> {
  const pattern = rules.validationPattern.trim();
  if (pattern) {
    try {
      await testRegex(pattern, "");
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid regular expression.";
    }
  }
  if (pattern && rules.formatExample.trim()) {
    const matches = await patternMatches(rules, rules.formatExample.trim());
    if (!matches) return "Format example does not match the validation pattern.";
  }
  return null;
}

function lengthLimit(rules: FieldRules): number | null {
  // A link stores record ids, so a character limit would cap how many records can be linked.
  if (rules.dataType === "RECORD_LINK") return null;
  if (rules.maxLength && rules.maxLength > 0) return rules.maxLength;
  if (rules.dataType === "TEXT") return 512;
  if (rules.dataType === "BIG_TEXT") return 6400;
  return null;
}

export async function validateValue(rules: FieldRules, raw: string): Promise<string | null> {
  const value = raw.trim();
  if (!value) {
    return rules.isRequired ? "This attribute is required." : null;
  }
  // Files are checked when they are uploaded, and saveRecord checks which files a value may list.
  if (rules.dataType === "FILE") return !rules.multiple && value.includes("|") ? "Attach one file." : null;

  const limit = lengthLimit(rules);
  if (limit && value.length > limit) {
    return `Use at most ${limit} characters.`;
  }

  if (rules.dataType === "NUMERIC") {
    const numeric = value.replace(/,/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(numeric)) return "Enter a number.";
    const hasDecimal = numeric.includes(".");
    if (!rules.decimalOk && hasDecimal) return "Decimals are not allowed.";
    const number = Number(numeric);
    if (!rules.negativeOk && number < 0) return "Negative values are not allowed.";
    if (rules.minValue != null && number < rules.minValue) return `Enter at least ${rules.minValue}.`;
    if (rules.maxValue != null && number > rules.maxValue) return `Enter at most ${rules.maxValue}.`;
  }

  if (rules.dataType === "DATE" || rules.dataType === "DATETIME") {
    const parsed = new Date(rules.dataType === "DATE" ? `${value}T12:00:00` : value);
    if (Number.isNaN(parsed.getTime())) return "Enter a valid date.";
    if (rules.minDate && value.slice(0, 10) < rules.minDate) return `Date must be on or after ${rules.minDate}.`;
    if (rules.maxDate && value.slice(0, 10) > rules.maxDate) return `Date must be on or before ${rules.maxDate}.`;
  }

  if (rules.dataType === "TIME") {
    const match = rules.is24Hour
      ? /^([01]\d|2[0-3]):[0-5]\d$/.exec(value)
      : /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i.exec(value);
    if (!match) return rules.is24Hour ? "Use HH:MM in 24-hour time." : "Use HH:MM AM or PM.";
  }

  if (rules.dataType === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter an email address.";
  }
  if (rules.dataType === "ZIPCODE" && !/^\d{5}(-\d{4})?$/.test(value)) {
    return "Enter a 5-digit zip code.";
  }
  if (rules.dataType === "PHONE" && value.replace(/\D/g, "").length < 10) {
    return "Enter a phone number with at least 10 digits.";
  }
  if (rules.dataType === "COORDINATE" && !/^\(?-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?\)?$/.test(value)) {
    return "Enter a coordinate as latitude, longitude.";
  }

  if (rules.dataType === "RADIO" || rules.dataType === "DROPDOWN" || rules.dataType === "RECORD_LINK") {
    const allowed = new Set(rules.options.map((option) => option.value));
    const selected = rules.multiple ? value.split("|").filter(Boolean) : [value];
    if (!rules.multiple && selected.length !== 1) return "Choose one value.";
    if (selected.some((item) => !allowed.has(item))) {
      return rules.dataType === "RECORD_LINK" ? "Choose an active record of the linked type." : "Choose one of the allowed values.";
    }
  }

  if (rules.validationPattern.trim()) {
    const matches = await patternMatches(rules, value);
    if (!matches) {
      return "Value does not match the regular expression.";
    }
  }

  return null;
}

export function displayDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[2]}/${match[3]}/${match[1]}`;
}
