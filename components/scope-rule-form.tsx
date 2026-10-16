"use client";

import { useEffect, useState } from "react";
import { saveScopeRule, searchScopeRecords, type PickerRecord } from "@/lib/scope-actions";

export type ScopeRuleType = { id: string; name: string };
export type ScopeRuleField = {
  id: string;
  recordTypeId: string;
  name: string;
  dataType: string;
  linkTypeId: string | null;
  options: { value: string; label: string }[];
};
export type ScopeRuleRecord = PickerRecord;
export type ScopeRecordRule = { id: string; recordTypeId: string; label: string };

export type ScopeRuleInitial = {
  id: string;
  recordTypeId: string;
  kind: "RECORDS" | "ATTRIBUTE";
  fieldId: string;
  sourceRuleId: string;
  recordIds: string[];
  values: string[];
};

/**
 * Picks records of one type. Records are searched on the server, a page at a time, so the
 * Scopes page stays light however many records there are. Chosen records stay listed above
 * the results and are posted as hidden inputs.
 */
function RecordPicker({
  recordTypeId,
  name,
  label,
  initial,
}: {
  recordTypeId: string;
  name: string;
  label: string;
  initial: PickerRecord[];
}) {
  const [chosen, setChosen] = useState<PickerRecord[]>(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const found = await searchScopeRecords(recordTypeId, query);
      if (current) {
        setResults(found);
        setLoading(false);
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [recordTypeId, query]);

  // Records of another type are dropped when the type changes.
  const shownChosen = chosen.filter((record) => record.recordTypeId === recordTypeId);
  const chosenIds = new Set(shownChosen.map((record) => record.id));
  const toggle = (record: PickerRecord) =>
    setChosen((list) => (list.some((item) => item.id === record.id) ? list.filter((item) => item.id !== record.id) : [...list, record]));

  return (
    <div>
      <span className="label">{label}</span>
      {shownChosen.map((record) => <input key={record.id} type="hidden" name={name} value={record.id} />)}
      {shownChosen.length ? (
        <ul className="mb-2 flex flex-wrap gap-2 text-sm" aria-label="Chosen records">
          {shownChosen.map((record) => (
            <li key={record.id} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5">
              {record.label}
              <button type="button" className="text-muted hover:text-danger" aria-label={`Remove ${record.label}`} onClick={() => toggle(record)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-sm text-muted">None chosen yet.</p>
      )}
      <input className="field mb-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by identifier" aria-label="Search records" />
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-sm" aria-busy={loading}>
        {loading && !results.length ? <p className="text-muted">Searching…</p> : null}
        {!loading && !results.length ? <p className="text-muted">No records match.</p> : null}
        {results.map((record) => (
          <label key={record.id} className="flex items-center gap-2">
            <input type="checkbox" checked={chosenIds.has(record.id)} onChange={() => toggle(record)} />
            {record.label}
          </label>
        ))}
        {results.length >= 50 ? <p className="text-xs text-muted">Showing the first 50. Search to narrow the list.</p> : null}
      </div>
    </div>
  );
}

/**
 * One rule: specific records of a type, or an attribute that must equal one of a list
 * (or the records of another rule in this scope).
 */
export function ScopeRuleForm({
  scopeId,
  types,
  fields,
  chosenRecords = [],
  recordRules,
  initial,
}: {
  scopeId: string;
  types: ScopeRuleType[];
  fields: ScopeRuleField[];
  /** Labels for the records this rule already names, so they show before any search. */
  chosenRecords?: PickerRecord[];
  recordRules: ScopeRecordRule[];
  initial?: ScopeRuleInitial;
}) {
  const [recordTypeId, setRecordTypeId] = useState(initial?.recordTypeId || types[0]?.id || "");
  const [kind, setKind] = useState<"RECORDS" | "ATTRIBUTE">(initial?.kind ?? "RECORDS");
  const [fieldId, setFieldId] = useState(initial?.fieldId ?? "");
  const typeFields = fields.filter((field) => field.recordTypeId === recordTypeId);
  const field = typeFields.find((item) => item.id === fieldId) ?? typeFields[0];
  const choiceType = field && (field.dataType === "RADIO" || field.dataType === "DROPDOWN" || field.dataType === "RECORD_LINK");
  const sourceChoices = recordRules.filter((rule) => !field || field.dataType !== "RECORD_LINK" || rule.recordTypeId === field.linkTypeId);
  const selectedValues = new Set(initial?.values ?? []);
  const pickerType = kind === "RECORDS" ? recordTypeId : field?.dataType === "RECORD_LINK" ? (field.linkTypeId ?? "") : "";
  const pickerInitial = chosenRecords.filter((record) =>
    kind === "RECORDS" ? initial?.recordIds.includes(record.id) : initial?.values.includes(record.id),
  );

  return (
    <form action={saveScopeRule} className="space-y-3 rounded-md border border-line p-3">
      <input type="hidden" name="scopeId" value={scopeId} />
      {initial ? <input type="hidden" name="ruleId" value={initial.id} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <span className="label">Record type</span>
          <select className="field" name="recordTypeId" value={recordTypeId} onChange={(event) => { setRecordTypeId(event.target.value); setFieldId(""); }}>
            {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Rule</span>
          <select className="field" name="kind" value={kind} onChange={(event) => setKind(event.target.value === "ATTRIBUTE" ? "ATTRIBUTE" : "RECORDS")}>
            <option value="RECORDS">These records</option>
            <option value="ATTRIBUTE">Attribute equals one of</option>
          </select>
        </label>
      </div>
      {kind === "ATTRIBUTE" ? (
        <label>
          <span className="label">Attribute</span>
          <select className="field" name="fieldId" value={field?.id ?? ""} onChange={(event) => setFieldId(event.target.value)}>
            {typeFields.length === 0 ? <option value="">No text, choice, or link attributes</option> : null}
            {typeFields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      ) : null}
      {kind === "ATTRIBUTE" && field?.dataType === "RECORD_LINK" ? (
        <label>
          <span className="label">Use the records from</span>
          <select className="field" name="sourceRuleId" defaultValue={initial?.sourceRuleId ?? ""}>
            <option value="">No record list</option>
            {sourceChoices.map((rule) => <option key={rule.id} value={rule.id}>{rule.label}</option>)}
          </select>
        </label>
      ) : null}
      {pickerType ? (
        <RecordPicker
          key={`${kind}-${pickerType}`}
          recordTypeId={pickerType}
          name={kind === "RECORDS" ? "locationId" : "value"}
          label={kind === "RECORDS" ? "Records" : "Or these linked records"}
          initial={pickerInitial}
        />
      ) : null}
      {kind === "ATTRIBUTE" && choiceType && field?.dataType !== "RECORD_LINK" ? (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-sm">
          {field.options.length === 0 ? <p className="text-muted">This attribute has no choices yet.</p> : field.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input type="checkbox" name="value" value={option.value} defaultChecked={selectedValues.has(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      ) : null}
      {kind === "ATTRIBUTE" && field && !choiceType ? (
        <label>
          <span className="label">Values, one per line</span>
          <textarea className="field min-h-24" name="values" defaultValue={initial?.values.join("\n") ?? ""} />
          <span className="mt-1 block text-xs text-muted">
            {field.dataType === "PHONE" || field.dataType === "ZIPCODE"
              ? "Compared by digits only, so (213) 555-0123 matches 213-555-0123."
              : "Capitals and extra spaces are ignored."}
          </span>
        </label>
      ) : null}
      <button className="btn" type="submit">{initial ? "Save rule" : "Add rule"}</button>
    </form>
  );
}
