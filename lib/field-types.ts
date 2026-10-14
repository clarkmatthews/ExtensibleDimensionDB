export const DATA_TYPES = [
  "TEXT",
  "BIG_TEXT",
  "NUMERIC",
  "DATE",
  "TIME",
  "CHECKBOX",
  "RADIO",
  "DROPDOWN",
  "DATETIME",
  "ZIPCODE",
  "ADDRESS",
  "EMAIL",
  "PHONE",
  "COORDINATE",
  "RECORD_LINK",
  "FILE",
] as const;

export type DataTypeName = (typeof DATA_TYPES)[number];

export const TYPE_LABELS: Record<DataTypeName, string> = {
  TEXT: "Text",
  BIG_TEXT: "Big text",
  NUMERIC: "Numeric",
  DATE: "Date",
  TIME: "Time",
  CHECKBOX: "Checkbox",
  RADIO: "Radio",
  DROPDOWN: "List",
  DATETIME: "Date and time",
  ZIPCODE: "Zip code",
  ADDRESS: "Address",
  EMAIL: "Email",
  PHONE: "Phone",
  COORDINATE: "Coordinate",
  RECORD_LINK: "Link to record",
  FILE: "File",
};

/** Attribute types whose value is chosen from a set of options. */
export function isChoiceType(dataType: string) {
  return dataType === "DROPDOWN" || dataType === "RADIO" || dataType === "RECORD_LINK";
}
