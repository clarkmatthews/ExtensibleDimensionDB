"use client";

import { useState } from "react";

const FORMATS = [
  { id: "csv", label: "CSV" },
  { id: "xlsx", label: "Excel" },
  { id: "json", label: "JSON" },
  { id: "xml", label: "XML" },
];

/** The record type to import into, with sample files for that type in every format. */
export function ImportTypePicker({ types, initial }: { types: { id: string; name: string }[]; initial: string }) {
  const [typeId, setTypeId] = useState(types.some((type) => type.id === initial) ? initial : (types[0]?.id ?? ""));
  const current = types.find((type) => type.id === typeId);
  return (
    <>
      {types.length > 1 ? (
        <label>
          <span className="label">Record type</span>
          <select className="field" name="recordTypeId" value={typeId} onChange={(event) => setTypeId(event.target.value)}>
            {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </label>
      ) : (
        <input type="hidden" name="recordTypeId" value={typeId} />
      )}
      {current ? (
        <p className="w-full text-sm text-muted">
          Sample {current.name} file:{" "}
          {FORMATS.map((format, index) => (
            <span key={format.id}>
              {index ? " · " : ""}
              <a className="font-semibold text-pine hover:underline" href={`/api/import/sample?type=${encodeURIComponent(current.id)}&format=${format.id}`} download>
                {format.label}
              </a>
            </span>
          ))}
          . Each has the columns you can import, with an example row to replace.
        </p>
      ) : null}
    </>
  );
}
