"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { DefaultStoreDialog } from "@/components/default-store-dialog";
import { HelpTip } from "@/components/help-tip";
import type { ListItem, ListPeer } from "@/components/list-config-dialog";
import { saveField } from "@/lib/definition-actions";
import { DATA_TYPES, TYPE_LABELS, type DataTypeName } from "@/lib/field-types";
import { correlationLoops, isListType } from "@/lib/list-correlation";

export type FieldListChoice = {
  id: string;
  name: string;
  isActive: boolean;
  choiceSource: "MANUAL" | "US_STATE" | "US_CITY";
  parentListId: string;
  parentName: string;
  itemCount: number;
};

export type FieldDraft = {
  id: string;
  key: string;
  friendlyName: string;
  description: string;
  dataType: DataTypeName;
  isRequired: boolean;
  isStoreKey: boolean;
  isActiveFilter: boolean;
  isCreatedDate: boolean;
  choiceSource: "MANUAL" | "US_STATE" | "US_CITY";
  choiceListId: string;
  linkTypeId: string;
  parentFieldId: string;
  defaultValue: string;
  formatExample: string;
  validationPattern: string;
  useRegex: boolean;
  maxLength: string;
  minValue: string;
  maxValue: string;
  negativeOk: boolean;
  decimalOk: boolean;
  numVisible: string;
  multiple: boolean;
  is24Hour: boolean;
  checkboxLabel: string;
  minDate: string;
  maxDate: string;
  fileTypes: string;
  options: ListItem[];
};

const empty = (): FieldDraft => ({
  id: "",
  key: "",
  friendlyName: "",
  description: "",
  dataType: "TEXT",
  isRequired: false,
  isStoreKey: false,
  isActiveFilter: false,
  isCreatedDate: false,
  choiceSource: "MANUAL",
  choiceListId: "",
  linkTypeId: "",
  parentFieldId: "",
  defaultValue: "",
  formatExample: "",
  validationPattern: "",
  useRegex: false,
  maxLength: "50",
  minValue: "",
  maxValue: "",
  negativeOk: false,
  decimalOk: false,
  numVisible: "1",
  multiple: false,
  fileTypes: "",
  is24Hour: true,
  checkboxLabel: "",
  minDate: "",
  maxDate: "",
  options: [
    { label: "", value: "", isDefault: false, parentValues: "" },
    { label: "", value: "", isDefault: false, parentValues: "" },
  ],
});

/** A small label beside an attribute's name. */
function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "strong" | "muted" }) {
  const styles = {
    plain: "border-line bg-paper text-ink",
    strong: "border-pine/30 bg-pine/10 text-pine",
    muted: "border-line bg-paper text-muted",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

/**
 * One attribute of a dimension: a row with its name, key, type, flags, and actions, that opens
 * into its settings. Without `initial` it is the dimension's Add attribute button, which opens
 * an empty form and closes again once the new attribute is saved.
 */
export function FieldForm({
  categoryId,
  categoryName = "",
  initial,
  isActive = true,
  editable = true,
  actions,
  lists = [],
  catalogs = [],
  canManageLists = false,
  recordTypes = [],
}: {
  categoryId: string;
  /** The dimension's name, shown on the Add attribute button and the new attribute's form. */
  categoryName?: string;
  initial?: FieldDraft;
  /** False for a hidden attribute, which is shown dimmed with a Hidden badge. */
  isActive?: boolean;
  /** False when the person may not edit attributes here: the row shows, without its settings. */
  editable?: boolean;
  /** Move, hide, and delete controls for the row. */
  actions?: ReactNode;
  lists?: ListPeer[];
  catalogs?: FieldListChoice[];
  canManageLists?: boolean;
  recordTypes?: { id: string; name: string }[];
}) {
  const [draft, setDraft] = useState<FieldDraft>(initial ?? empty());
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [askStores, setAskStores] = useState(false);
  const [pendingDefault, setPendingDefault] = useState(initial?.defaultValue ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, startSaving] = useTransition();
  const promptedDefault = useRef(initial?.defaultValue ?? "");
  const resumeSave = useRef(false);
  const opening = useRef(false);

  function patch(partial: Partial<FieldDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function promptForStores(fromSave: boolean, raw = draft.defaultValue) {
    if (opening.current) {
      if (fromSave) resumeSave.current = true;
      return true;
    }
    if (!draft.id || draft.isCreatedDate || raw === promptedDefault.current) return false;
    opening.current = true;
    resumeSave.current = fromSave;
    promptedDefault.current = raw;
    setPendingDefault(raw);
    setAskStores(true);
    return true;
  }

  function closeStorePrompt() {
    const shouldSave = resumeSave.current;
    resumeSave.current = false;
    opening.current = false;
    setAskStores(false);
    if (shouldSave) formRef.current?.requestSubmit();
  }

  async function onSubmit(formData: FormData) {
    if (promptForStores(true)) return;
    formData.set("options", JSON.stringify(draft.options));
    formData.set("dataType", draft.dataType);
    const result = await saveField(formData);
    setError(result?.error ?? "");
    // A new attribute now appears in the list above, so the add form empties and closes.
    if (!initial && !result?.error) {
      setDraft(empty());
      setOpen(false);
    }
  }

  function cancelNew() {
    setDraft(empty());
    setError("");
    setOpen(false);
  }

  // Submitted by hand rather than through a form action, because React resets a form after its
  // action finishes, which put the inputs back to the definition as it was before the save.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startSaving(() => onSubmit(formData));
  }

  const showLength = draft.dataType === "TEXT" || draft.dataType === "BIG_TEXT" || draft.dataType === "ADDRESS";
  const showNumeric = draft.dataType === "NUMERIC";
  const isFile = draft.dataType === "FILE";
  const selectedCatalog = catalogs.find((catalog) => catalog.id === draft.choiceListId);

  const formId = `attribute-${initial?.id ?? `new-${categoryId}`}`;
  const savedName = initial?.friendlyName ?? "";

  const header = initial ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className={`flex min-w-0 flex-1 flex-wrap items-center gap-2 ${isActive ? "" : "opacity-60"}`}>
        <span className="font-semibold">{savedName}</span>
        <span className="font-mono text-xs text-muted">{initial.key}</span>
        <Badge>{TYPE_LABELS[initial.dataType]}</Badge>
        {initial.isStoreKey ? <Badge tone="strong">Unique identifier</Badge> : null}
        {initial.isRequired ? <Badge tone="strong">Required</Badge> : null}
        {!isActive ? <Badge tone="muted">Hidden</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {editable ? (
          <button
            className={open ? "btn" : "btn-quiet"}
            type="button"
            aria-expanded={open}
            aria-controls={formId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Close" : "Edit"}
          </button>
        ) : null}
      </div>
    </div>
  ) : null;

  if (!initial && !open) {
    return (
      <div className="px-4 py-3">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line px-4 py-3 text-sm font-semibold text-pine hover:border-pine hover:bg-pine/5"
          type="button"
          aria-expanded={false}
          aria-controls={formId}
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          Add attribute{categoryName ? ` to ${categoryName}` : ""}
        </button>
      </div>
    );
  }

  return (
    <div className={initial ? `border-t border-line ${open ? "bg-pine/5" : ""}` : "px-4 py-3"}>
      {header}
      {open ? (
        <section
          id={formId}
          aria-label={initial ? `Editing ${savedName}` : "New attribute"}
          className={initial ? "mx-4 mb-4 rounded-lg border-2 border-pine/40 bg-card shadow-sm" : "rounded-lg border-2 border-pine bg-card shadow-sm"}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h3 className="font-semibold text-pine">
              {initial ? <>Editing <span className="text-ink">{savedName}</span></> : <>New attribute{categoryName ? <> in <span className="text-ink">{categoryName}</span></> : null}</>}
            </h3>
            {!initial ? (
              <button className="btn-quiet" type="button" onClick={cancelNew}>Cancel</button>
            ) : null}
          </div>
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-3 p-4 md:grid-cols-2">
          <input type="hidden" name="id" value={draft.id} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="choiceSource" value={draft.choiceSource} />
          <input type="hidden" name="choiceListId" value={isListType(draft.dataType) ? draft.choiceListId : ""} />
          <input type="hidden" name="parentFieldId" value={draft.parentFieldId} />
          <input type="hidden" name="multiple" value={draft.multiple ? "on" : ""} />
          <input type="hidden" name="numVisible" value={draft.numVisible} />
          {error ? <p className="md:col-span-2 text-sm text-danger">{error}</p> : null}
          <label>
            <span className="label">Attribute key <HelpTip text="The system key for this attribute. Use letters, numbers, and underscores. It is not the name people see." /></span>
            <input className="field font-mono" name="key" value={draft.key} onChange={(event) => patch({ key: event.target.value })} required />
          </label>
          <label>
            <span className="label">Display name <HelpTip text="The name shown on the dimension editor and on the Dimensions page." /></span>
            <input className="field" name="friendlyName" value={draft.friendlyName} onChange={(event) => patch({ friendlyName: event.target.value })} required />
          </label>
          <label className="md:col-span-2">
            <span className="label">Description <HelpTip text="Shown as help beside this attribute while a dimension is edited." /></span>
            <input className="field" name="description" value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
            <span className="mt-1 block text-xs text-muted">Shown as help beside the attribute in the dimension editor.</span>
          </label>
          <label>
            <span className="label">Type <HelpTip text="What the attribute accepts: text, a long note, a number, a date or time, a checkbox, a radio list, a dropdown list, a link to another record, or uploaded files." /></span>
            <select
              className="field"
              value={draft.dataType}
              onChange={(event) => {
                const dataType = event.target.value as DataTypeName;
                patch({
                  dataType,
                  isActiveFilter: dataType === "CHECKBOX" ? draft.isActiveFilter : false,
                  isCreatedDate: dataType === "DATE" ? draft.isCreatedDate : false,
                });
              }}
            >
              {DATA_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          {isFile ? (
            <>
              <label>
                <span className="label">
                  Accepted file types <HelpTip text="Extensions separated by commas, such as .pdf, .docx. Leave blank to accept PDF, Word, Excel, PowerPoint, text, CSV, PNG, and JPEG files." />
                </span>
                <input className="field" name="fileTypes" placeholder=".pdf, .docx" value={draft.fileTypes} onChange={(event) => patch({ fileTypes: event.target.value })} />
                <span className="mt-1 block text-xs text-muted">Up to 10 MB per file. Files are stored in the database with the record.</span>
              </label>
              <label className="flex items-center gap-2 self-start pt-7 text-sm">
                <input type="checkbox" checked={draft.multiple} onChange={(event) => patch({ multiple: event.target.checked })} />
                Several files
                <HelpTip text="Off: the attribute holds one file, and uploading another replaces it. On: people can add as many files as they need." />
              </label>
            </>
          ) : null}
          {isFile ? null : <>
          <label>
            <span className="label">Default value <HelpTip text="The value a new dimension starts with. After you change it on an existing attribute, you can apply it to selected dimensions." /></span>
            <input
              className="field"
              name="defaultValue"
              value={draft.defaultValue}
              onChange={(event) => patch({ defaultValue: event.target.value })}
              onBlur={(event) => {
                const next = event.currentTarget.value;
                if (next !== draft.defaultValue) patch({ defaultValue: next });
                promptForStores(false, next);
              }}
            />
            {draft.id && !draft.isCreatedDate ? (
              <span className="mt-1 block text-xs text-muted">After you change this, choose which dimensions receive the new value.</span>
            ) : null}
          </label>
          <label>
            <span className="label">Format example <HelpTip text="An example of a valid value. Saving the attribute requires this example to match the validation pattern." /></span>
            <input className="field" name="formatExample" value={draft.formatExample} onChange={(event) => patch({ formatExample: event.target.value })} />
          </label>
          <label>
            <span className="label">Validation pattern <HelpTip text="A regular expression. Leave it blank when the attribute type is enough. Saving checks that the format example matches this pattern." /></span>
            <input className="field font-mono" name="validationPattern" value={draft.validationPattern} onChange={(event) => patch({ validationPattern: event.target.value })} />
          </label>
          </>}
          <label className="flex items-center gap-2 text-sm">
            <input name="isRequired" type="checkbox" checked={draft.isRequired} onChange={(event) => patch({ isRequired: event.target.checked })} />
            Required
            <HelpTip text="The dimension cannot be saved while this attribute is empty." />
          </label>
          {isFile ? null : (
          <label className="flex items-center gap-2 text-sm">
            <input name="isStoreKey" type="checkbox" checked={draft.isStoreKey} onChange={(event) => patch({ isStoreKey: event.target.checked })} />
            Unique dimension identifier
            <HelpTip text="This value identifies the dimension in action reports. Two dimensions should not share it." />
          </label>
          )}
          {showLength ? (
            <label>
              <span className="label">Max length</span>
              <input className="field" name="maxLength" value={draft.maxLength} onChange={(event) => patch({ maxLength: event.target.value })} />
            </label>
          ) : (
            <input type="hidden" name="maxLength" value={draft.maxLength} />
          )}
          {showNumeric ? (
            <>
              <label>
                <span className="label">Minimum</span>
                <input className="field" name="minValue" value={draft.minValue} onChange={(event) => patch({ minValue: event.target.value })} />
              </label>
              <label>
                <span className="label">Maximum</span>
                <input className="field" name="maxValue" value={draft.maxValue} onChange={(event) => patch({ maxValue: event.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input name="negativeOk" type="checkbox" checked={draft.negativeOk} onChange={(event) => patch({ negativeOk: event.target.checked })} />
                Negative OK
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input name="decimalOk" type="checkbox" checked={draft.decimalOk} onChange={(event) => patch({ decimalOk: event.target.checked })} />
                Decimal OK
              </label>
            </>
          ) : null}
          {draft.dataType === "TIME" ? (
            <label className="flex items-center gap-2 text-sm">
              <input name="is24Hour" type="checkbox" checked={draft.is24Hour} onChange={(event) => patch({ is24Hour: event.target.checked })} />
              24-hour time
            </label>
          ) : null}
          {draft.dataType === "CHECKBOX" ? (
            <>
              <label>
                <span className="label">
                  Checkbox label <HelpTip text="Shown beside the box, and as the selected value on the Dimensions list. Leave it blank to show Yes when selected and No when clear." />
                </span>
                <input className="field" name="checkboxLabel" value={draft.checkboxLabel} onChange={(event) => patch({ checkboxLabel: event.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input name="isActiveFilter" type="checkbox" checked={draft.isActiveFilter} onChange={(event) => patch({ isActiveFilter: event.target.checked })} />
                Use this checkbox as the default Active filter
                <HelpTip text="The Dimensions list and CSV export start with this checkbox selected. The shared API includes a dimension only when it is selected. Only one attribute can have this role." />
              </label>
            </>
          ) : null}
          {draft.dataType === "DATE" ? (
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input name="isCreatedDate" type="checkbox" checked={draft.isCreatedDate} onChange={(event) => patch({ isCreatedDate: event.target.checked })} />
              Fill from the date the record was added, and keep it read-only
              <HelpTip text="New dimensions store the date they were added. People cannot edit it, and a later default is not applied to existing dimensions. Only one attribute can have this role." />
            </label>
          ) : null}
          {draft.dataType === "DATE" || draft.dataType === "DATETIME" ? (
            <>
              <label>
                <span className="label">Earliest date</span>
                <input className="field" type="date" name="minDate" value={draft.minDate} onChange={(event) => patch({ minDate: event.target.value })} />
              </label>
              <label>
                <span className="label">Latest date</span>
                <input className="field" type="date" name="maxDate" value={draft.maxDate} onChange={(event) => patch({ maxDate: event.target.value })} />
              </label>
            </>
          ) : null}
          {isListType(draft.dataType) ? (
            <div className="md:col-span-2 space-y-3">
              <label>
                <span className="label">List</span>
                <select
                  className="field"
                  value={draft.choiceListId}
                  onChange={(event) => {
                    const choiceListId = event.target.value;
                    const catalog = catalogs.find((item) => item.id === choiceListId);
                    const matches = catalog?.parentListId
                      ? lists.filter((peer) => peer.choiceListId === catalog.parentListId)
                      : [];
                    patch({
                      choiceListId,
                      choiceSource: catalog?.choiceSource ?? "MANUAL",
                      parentFieldId: matches.length === 1 ? matches[0].id : draft.parentFieldId,
                    });
                  }}
                >
                  <option value="">Choose a list</option>
                  {catalogs
                    .filter((catalog) => catalog.isActive || catalog.id === draft.choiceListId)
                    .map((catalog) => (
                      <option key={catalog.id} value={catalog.id}>
                        {catalog.isActive ? catalog.name : `${catalog.name} (inactive)`}
                      </option>
                    ))}
                </select>
              </label>
              <p className="text-sm text-muted">
                {selectedCatalog
                  ? selectedCatalog.parentName
                    ? `${selectedCatalog.itemCount} items correlated to ${selectedCatalog.parentName}. Set Follows to the attribute that uses ${selectedCatalog.parentName}. Another list can follow this one, and another attribute can follow this attribute.`
                    : `${selectedCatalog.itemCount} items.`
                  : "Choose a list for this attribute."}
                {selectedCatalog?.parentName ? ` That list follows ${selectedCatalog.parentName}.` : ""}
                {draft.parentFieldId
                  ? ` This attribute follows ${lists.find((list) => list.id === draft.parentFieldId)?.friendlyName ?? "another attribute"}.`
                  : " This attribute does not follow another attribute."}
              </p>
              {canManageLists ? (
                <Link className="text-sm font-semibold text-pine" href={draft.choiceListId ? `/admin/lists?open=${draft.choiceListId}` : "/admin/lists"}>
                  Manage lists
                </Link>
              ) : null}
              <label>
                <span className="label">Follows <HelpTip text="The dimension uses the selected attribute&apos;s value to decide which items to show. Point a third attribute at this one when the choices should narrow again." /></span>
                <select className="field" value={draft.parentFieldId} onChange={(event) => patch({ parentFieldId: event.target.value })}>
                  <option value="">No other attribute</option>
                  {lists
                    .filter((peer) => !correlationLoops(peer.id, draft.id, (id) => lists.find((item) => item.id === id)?.parentFieldId ?? ""))
                    .map((peer) => (
                      <option key={peer.id} value={peer.id}>
                        {peer.friendlyName}
                      </option>
                    ))}
                </select>
                <span className="mt-1 block text-xs text-muted">
                  The dimension uses the selected attribute&apos;s value to decide which items from the list to show.
                </span>
              </label>
              {draft.dataType === "DROPDOWN" ? (
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.multiple} onChange={(event) => patch({ multiple: event.target.checked })} />
                    Multiple selections
                  </label>
                  <label className="flex items-center gap-2">
                    Visible rows
                    <input className="field w-20" value={draft.numVisible} onChange={(event) => patch({ numVisible: event.target.value })} />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
          {draft.dataType === "RECORD_LINK" ? (
            <div className="space-y-2 md:col-span-2">
              <label>
                <span className="label">
                  Links to <HelpTip text="The record type this attribute points to. On a record, people choose from the active records of that type, by their unique identifier. The linked record lists this one under Linked from." />
                </span>
                <select className="field" name="linkTypeId" value={draft.linkTypeId} onChange={(event) => patch({ linkTypeId: event.target.value })} required>
                  <option value="">Choose a record type</option>
                  {recordTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.multiple} onChange={(event) => patch({ multiple: event.target.checked })} />
                  Several records
                </label>
                <label className="flex items-center gap-2">
                  Visible rows
                  <input className="field w-20" value={draft.numVisible} onChange={(event) => patch({ numVisible: event.target.value })} />
                </label>
              </div>
            </div>
          ) : null}
          <div className="md:col-span-2">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Saving…" : initial ? "Save attribute" : "Add attribute"}
            </button>
            {initial ? (
              <button className="btn-quiet ml-2" type="button" onClick={() => setOpen(false)}>Close</button>
            ) : (
              <button className="btn-quiet ml-2" type="button" onClick={cancelNew}>Cancel</button>
            )}
          </div>
        </form>
        </section>
      ) : null}
      {askStores && draft.id ? (
        <DefaultStoreDialog fieldId={draft.id} value={pendingDefault} onClose={closeStorePrompt} />
      ) : null}
    </div>
  );
}

export function blankField(): FieldDraft {
  return empty();
}
