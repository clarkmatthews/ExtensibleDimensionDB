"use client";

import { useRef, useState } from "react";
import { saveStore } from "@/lib/store-actions";
import { formatBytes, MAX_FILE_BYTES, MAX_UPLOAD_BYTES, parseFileTokens } from "@/lib/files";
import { choicesForParent, type ListChoice } from "@/lib/list-correlation";

export type EditorField = {
  id: string;
  friendlyName: string;
  description: string;
  dataType: string;
  formatExample: string;
  canUpdate: boolean;
  isRequired: boolean;
  checkboxLabel: string;
  multiple: boolean;
  numVisible: number;
  value: string;
  choiceSource: "MANUAL" | "US_STATE" | "US_CITY";
  choiceListId: string;
  remote: boolean;
  parentFieldId: string;
  options: ListChoice[];
  highlighted: boolean;
  /** File attributes: the accepted extensions, such as ".pdf,.docx". */
  accept?: string;
};

export type EditorCategory = {
  id: string;
  name: string;
  description: string;
  fields: EditorField[];
};

export function StoreForm({
  locationId,
  recordTypeId,
  categories,
  readOnly,
}: {
  locationId?: string;
  recordTypeId?: string;
  categories: EditorCategory[];
  readOnly: boolean;
}) {
  const fields = categories.flatMap((category) => category.fields);
  const [focus, setFocus] = useState("");
  const [error, setError] = useState("");
  const [placeValues, setPlaceValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((field) => correlated(field, fields)).map((field) => [field.id, field.value])),
  );
  const [remoteChoices, setRemoteChoices] = useState<Record<string, ListChoice[]>>(() =>
    Object.fromEntries(fields.filter((field) => field.remote).map((field) => [field.id, field.options])),
  );
  const requests = useRef(new Map<string, number>());

  function parentOf(field: EditorField) {
    if (!field.parentFieldId) return undefined;
    return fields.find((item) => item.id === field.parentFieldId);
  }

  async function loadRemote(field: EditorField, parentRaw: string) {
    const nextId = (requests.current.get(field.id) ?? 0) + 1;
    requests.current.set(field.id, nextId);
    if (!parentRaw.trim() || !field.choiceListId) {
      setRemoteChoices((current) => ({ ...current, [field.id]: [] }));
      return [] as ListChoice[];
    }
    const response = await fetch(`/api/list-items?listId=${encodeURIComponent(field.choiceListId)}&parent=${encodeURIComponent(parentRaw)}`);
    if (!response.ok || requests.current.get(field.id) !== nextId) return [] as ListChoice[];
    const data = (await response.json()) as { items: ListChoice[] };
    if (requests.current.get(field.id) !== nextId) return [] as ListChoice[];
    setRemoteChoices((current) => ({ ...current, [field.id]: data.items }));
    return data.items;
  }

  async function changeValue(field: EditorField, next: string) {
    const updated = { ...placeValues, [field.id]: next };
    const jobs: EditorField[] = [];
    const queue = [field.id];
    const seen = new Set<string>([field.id]);
    while (queue.length) {
      const parentId = queue.shift() ?? "";
      const parentRaw = updated[parentId] ?? "";
      for (const child of fields) {
        if (child.parentFieldId !== parentId || seen.has(child.id)) continue;
        seen.add(child.id);
        if (child.remote) {
          updated[child.id] = "";
          jobs.push(child);
        } else {
          const allowed = new Set(choicesForParent(child.options, parentRaw, true).map((option) => option.value));
          updated[child.id] = (updated[child.id] ?? child.value).split("|").filter((value) => allowed.has(value)).join("|");
        }
        queue.push(child.id);
      }
    }
    setPlaceValues({ ...updated });
    for (const child of jobs) {
      const parentRaw = updated[child.parentFieldId] ?? "";
      const previous = placeValues[child.id] ?? child.value;
      const items = await loadRemote(child, parentRaw);
      const keep = items.some((item) => item.value === previous) ? previous : "";
      updated[child.id] = keep;
      setPlaceValues({ ...updated });
      if (!keep) continue;
      for (const grandchild of fields) {
        if (grandchild.parentFieldId !== child.id) continue;
        if (grandchild.remote) {
          const earlier = placeValues[grandchild.id] ?? grandchild.value;
          const nested = await loadRemote(grandchild, keep);
          updated[grandchild.id] = nested.some((item) => item.value === earlier) ? earlier : "";
        } else {
          const allowed = new Set(choicesForParent(grandchild.options, keep, true).map((option) => option.value));
          updated[grandchild.id] = (updated[grandchild.id] ?? grandchild.value).split("|").filter((value) => allowed.has(value)).join("|");
        }
      }
      setPlaceValues({ ...updated });
    }
  }

  async function onSubmit(formData: FormData) {
    // Size limits are checked here first, so a large file fails quickly instead of after uploading.
    const files = [...formData.entries()].filter(([key, value]) => key.startsWith("upload:") && typeof value !== "string").map(([, value]) => value as File);
    const tooLarge = files.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) return setError(`${tooLarge.name} is ${formatBytes(tooLarge.size)}. Files can be at most ${formatBytes(MAX_FILE_BYTES)}.`);
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_BYTES) {
      return setError(`Upload at most ${formatBytes(MAX_UPLOAD_BYTES)} of files in one save.`);
    }
    setError("");
    const result = await saveStore(formData);
    if (result?.error) setError(result.error);
  }

  return (
    <form action={onSubmit} className="space-y-6">
      {locationId ? <input type="hidden" name="locationId" value={locationId} /> : null}
      {!locationId && recordTypeId ? <input type="hidden" name="recordTypeId" value={recordTypeId} /> : null}
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {categories.map((category) => (
        <section key={category.id} className="panel p-4">
          <h2 className="text-lg font-semibold">{category.name}</h2>
          {category.description ? <p className="text-sm text-muted">{category.description}</p> : null}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {category.fields.map((field) => field.dataType === "FILE" ? (
              <div key={field.id} className={field.highlighted ? "rounded-md bg-amber-50 p-2" : ""}>
                <span className="label" title={field.description}>
                  {field.friendlyName}
                  {field.isRequired ? " *" : ""}
                </span>
                <FileControl field={field} disabled={readOnly || !field.canUpdate} />
                {field.description ? <span className="mt-1 block text-xs text-muted">{field.description}</span> : null}
              </div>
            ) : (
              <label key={field.id} className={field.highlighted ? "rounded-md bg-amber-50 p-2" : ""}>
                <span className="label" title={field.description}>
                  {field.friendlyName}
                  {field.isRequired ? " *" : ""}
                </span>
                <FieldControl
                  field={field}
                  options={
                    field.remote
                      ? (remoteChoices[field.id] ?? [])
                      : choicesForParent(field.options, placeValues[parentOf(field)?.id ?? ""] ?? "", Boolean(parentOf(field)))
                  }
                  value={placeValues[field.id]}
                  parentName={parentOf(field)?.friendlyName ?? ""}
                  disabled={readOnly || !field.canUpdate || (Boolean(parentOf(field)) && !(placeValues[parentOf(field)?.id ?? ""] ?? "").trim())}
                  onFocus={() => setFocus(field.id)}
                  onValue={(next) => {
                    if (correlated(field, fields) || fields.some((child) => parentOf(child)?.id === field.id)) void changeValue(field, next);
                  }}
                />
                {focus === field.id && field.formatExample ? (
                  <span className="mt-1 block text-xs text-muted">Example: {field.formatExample}</span>
                ) : null}
                {field.description ? <span className="mt-1 block text-xs text-muted">{field.description}</span> : null}
              </label>
            ))}
          </div>
        </section>
      ))}
      {readOnly ? <p className="text-sm text-muted">You can view these attributes. None of them are open for update.</p> : (
        <button className="btn" type="submit">{locationId ? "Save dimension" : "Create dimension"}</button>
      )}
    </form>
  );
}

function correlated(field: EditorField, fields: EditorField[]) {
  if (field.parentFieldId || field.remote) return true;
  return fields.some((child) => child.parentFieldId === field.id);
}

function FieldControl({
  field,
  options,
  value,
  parentName,
  disabled,
  onFocus,
  onValue,
}: {
  field: EditorField;
  options: ListChoice[];
  value?: string;
  parentName: string;
  disabled: boolean;
  onFocus: () => void;
  onValue: (value: string) => void;
}) {
  const name = `field:${field.id}`;
  if (field.dataType === "CHECKBOX") {
    return (
      <span className="flex items-center gap-2 text-sm">
        <input name={name} type="checkbox" value="1" defaultChecked={field.value === "1"} disabled={disabled} onFocus={onFocus} />
        {field.checkboxLabel || "Yes"}
      </span>
    );
  }
  if (field.dataType === "BIG_TEXT" || field.dataType === "ADDRESS") {
    return <textarea className="field min-h-24" name={name} defaultValue={field.value} disabled={disabled} onFocus={onFocus} />;
  }
  if (field.dataType === "RADIO") {
    return (
      <span className="flex flex-col gap-1 text-sm">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input type="radio" name={name} value={option.value} defaultChecked={field.value === option.value} disabled={disabled} onFocus={onFocus} />
            {option.label}
          </label>
        ))}
      </span>
    );
  }
  if (field.dataType === "DROPDOWN" || field.dataType === "RECORD_LINK") {
    const current = value ?? field.value;
    const selected = current.split("|").filter(Boolean);
    const controlled = value !== undefined;
    return (
      <select
        className="field"
        name={name}
        value={controlled ? (field.multiple ? selected : current) : undefined}
        defaultValue={controlled ? undefined : field.multiple ? [...selected] : field.value}
        multiple={field.multiple}
        size={field.multiple ? field.numVisible : undefined}
        disabled={disabled}
        onFocus={onFocus}
        onChange={(event) =>
          onValue(field.multiple ? [...event.target.selectedOptions].map((option) => option.value).join("|") : event.target.value)
        }
      >
        {!field.multiple ? <option value="">{disabled && parentName ? `Select ${parentName} first` : ""}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const type = field.dataType === "DATE" ? "date" : field.dataType === "DATETIME" ? "datetime-local" : field.dataType === "TIME" ? "text" : field.dataType === "NUMERIC" ? "text" : "text";
  return <input className="field" type={type} name={name} defaultValue={field.value} disabled={disabled} onFocus={onFocus} />;
}

/** The files an attribute holds, each a link, with Remove boxes and a picker for new files. */
function FileControl({ field, disabled }: { field: EditorField; disabled: boolean }) {
  const files = parseFileTokens(field.value);
  return (
    <div className="space-y-2 text-sm">
      {files.length ? (
        <ul className="space-y-1">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-muted">
                <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
                <path d="M14 3v5h5" />
              </svg>
              <a className="min-w-0 flex-1 truncate font-medium text-pine hover:underline" href={`/api/files/${file.id}`} target="_blank" rel="noopener">
                {file.name}
              </a>
              <a className="text-xs text-muted hover:text-ink" href={`/api/files/${file.id}?download=1`}>Download</a>
              {disabled ? null : (
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" name={`remove:${field.id}`} value={file.id} />
                  Remove
                </label>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No file yet.</p>
      )}
      {disabled ? null : (
        <>
          <input type="hidden" name={`files:${field.id}`} value="1" />
          <input
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium"
            type="file"
            name={`upload:${field.id}`}
            accept={field.accept}
            multiple={field.multiple}
            aria-label={`Add ${field.multiple ? "files" : "a file"} to ${field.friendlyName}`}
          />
          <span className="block text-xs text-muted">
            {field.multiple ? "Add one or more files." : files.length ? "Choosing a file replaces the current one." : "Choose a file."} Up to {formatBytes(MAX_FILE_BYTES)} each
            {field.accept ? `: ${field.accept.split(",").join(", ")}` : ""}. Files are saved when you save the record.
          </span>
        </>
      )}
    </div>
  );
}
