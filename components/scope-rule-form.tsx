"use client";

import { useState } from "react";
import { saveScopeRule } from "@/lib/scope-actions";

export type ScopeRuleType = { id: string; name: string };
export type ScopeRuleField = {
  id: string;
  recordTypeId: string;
  name: string;
  dataType: string;
  linkTypeId: string | null;
  options: { value: string; label: string }[];
};
export type ScopeRuleRecord = { id: string; recordTypeId: string; label: string };
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
 * One rule: specific records of a type, or an attribute that must equal one of a list
 * (or the records of another rule in this scope).
 */
export function ScopeRuleForm({
  scopeId,
  types,
  fields,
  records,
  recordRules,
  initial,
}: {
  scopeId: string;
  types: ScopeRuleType[];
  fields: ScopeRuleField[];
  records: ScopeRuleRecord[];
  recordRules: ScopeRecordRule[];
  initial?: ScopeRuleInitial;
}) {
  const [recordTypeId, setRecordTypeId] = useState(initial?.recordTypeId || types[0]?.id || "");
  const [kind, setKind] = useState<"RECORDS" | "ATTRIBUTE">(initial?.kind ?? "RECORDS");
  const [fieldId, setFieldId] = useState(initial?.fieldId ?? "");
  const [filter, setFilter] = useState("");
  const typeFields = fields.filter((field) => field.recordTypeId === recordTypeId);
  const field = typeFields.find((item) => item.id === fieldId) ?? typeFields[0];
  const choiceType = field && (field.dataType === "RADIO" || field.dataType === "DROPDOWN" || field.dataType === "RECORD_LINK");
  const listRecords = kind === "RECORDS"
    ? records.filter((record) => record.recordTypeId === recordTypeId)
    : records.filter((record) => field?.dataType === "RECORD_LINK" && record.recordTypeId === field.linkTypeId);
  const needle = filter.trim().toLowerCase();
  const shownRecords = listRecords.filter((record) => !needle || record.label.toLowerCase().includes(needle));
  const sourceChoices = recordRules.filter((rule) => !field || field.dataType !== "RECORD_LINK" || rule.recordTypeId === field.linkTypeId);
  const selected = new Set(initial?.recordIds ?? []);
  const selectedValues = new Set(initial?.values ?? []);

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
      {kind === "RECORDS" || (kind === "ATTRIBUTE" && field?.dataType === "RECORD_LINK") ? (
        <div>
          <span className="label">{kind === "RECORDS" ? "Records" : "Or these linked records"}</span>
          <input className="field mb-2" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by name" aria-label="Filter records" />
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-sm">
            {shownRecords.length === 0 ? <p className="text-muted">No records.</p> : shownRecords.map((record) => (
              <label key={record.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={kind === "RECORDS" ? "locationId" : "value"}
                  value={record.id}
                  defaultChecked={kind === "RECORDS" ? selected.has(record.id) : selectedValues.has(record.id)}
                />
                {record.label}
              </label>
            ))}
          </div>
        </div>
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
        </label>
      ) : null}
      <button className="btn" type="submit">{initial ? "Save rule" : "Add rule"}</button>
    </form>
  );
}
