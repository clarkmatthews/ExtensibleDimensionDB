"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmDelete } from "@/components/confirm-delete";
import type { DataTypeName } from "@/lib/field-types";
import { previewListItemDelete, removeListItem } from "@/lib/list-actions";

export type ListPeer = {
  id: string;
  friendlyName: string;
  choiceSource: "MANUAL" | "US_STATE" | "US_CITY";
  choiceListId?: string;
  parentFieldId: string;
  options: { label: string; value: string }[];
};

export type ListItem = {
  id?: string;
  label: string;
  value: string;
  isDefault: boolean;
  parentValues: string;
  isActive?: boolean;
};

export function ListConfigDialog({
  fieldId,
  fieldName,
  dataType,
  multiple,
  numVisible,
  items,
  parentFieldId,
  peers,
  onClose,
  onApply,
  title = "Configure list",
  followsEmptyLabel = "No other attribute",
  showPresentation = true,
  applyLabel = "Use this list",
  identity,
}: {
  fieldId: string;
  fieldName: string;
  dataType: DataTypeName;
  choiceSource: "MANUAL" | "US_STATE" | "US_CITY";
  multiple: boolean;
  numVisible: string;
  items: ListItem[];
  parentFieldId: string;
  peers: ListPeer[];
  onClose: () => void;
  onApply: (next: { items: ListItem[]; parentFieldId: string; multiple: boolean; numVisible: string; name: string; description: string }) => void | Promise<string | void>;
  title?: string;
  followsEmptyLabel?: string;
  showPresentation?: boolean;
  applyLabel?: string;
  identity?: { name: string; description: string };
}) {
  const [rows, setRows] = useState(items);
  const [parentId, setParentId] = useState(parentFieldId);
  const [allowMultiple, setAllowMultiple] = useState(multiple);
  const [visibleRows, setVisibleRows] = useState(numVisible);
  const [error, setError] = useState("");
  const [name, setName] = useState(identity?.name ?? fieldName);
  const [description, setDescription] = useState(identity?.description ?? "");
  const candidates = useMemo(
    () => peers.filter((peer) => peer.id !== fieldId && !follows(peer, fieldId, peers)),
    [fieldId, peers],
  );
  const parent = candidates.find((peer) => peer.id === parentId) ?? peers.find((peer) => peer.id === parentId);
  const parentChoices = parent?.options ?? [];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function apply() {
    const cleaned = rows
      .map((row) => ({
        ...row,
        label: row.label.trim(),
        value: row.value.trim() || row.label.trim(),
        parentValues: row.parentValues.split("|").map((value) => value.trim()).filter(Boolean).join("|"),
        isActive: row.isActive !== false,
      }))
      .filter((row) => row.label);
    const activeCount = cleaned.filter((row) => row.isActive !== false).length;
    if (dataType === "RADIO" && (activeCount < 2 || activeCount > 5)) {
      setError("A radio list needs between 2 and 5 active items.");
      return;
    }
    if (dataType === "DROPDOWN" && activeCount < 1) {
      setError("Add at least one active list item.");
      return;
    }
    if (identity && !name.trim()) {
      setError("List name is required.");
      return;
    }
    const message = await onApply({
      items: cleaned,
      parentFieldId: parentId,
      multiple: dataType === "DROPDOWN" ? allowMultiple : false,
      numVisible: visibleRows,
      name: name.trim(),
      description: description.trim(),
    });
    if (message) setError(message);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="panel flex max-h-[85vh] w-full max-w-3xl flex-col p-4" role="dialog" aria-modal="true" aria-labelledby="list-config-title">
        <h2 id="list-config-title" className="text-lg font-semibold">{title}</h2>
        {identity ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label>
              <span className="label">Name</span>
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span className="label">Description</span>
              <input className="field" value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </div>
        ) : null}
        <p className="mt-1 text-sm text-muted">
          {fieldName || "This list"}
          {identity
            ? " stores its own values. Rename a value to update lists that follow this one. Delete a value to remove items and dimension values correlated to it."
            : " items are the choices shown on a dimension."}
        </p>
        <label className="mt-3 block">
          <span className="label">Follows</span>
          <select className="field" value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">{followsEmptyLabel}</option>
            {candidates.map((peer) => (
              <option key={peer.id} value={peer.id}>
                {peer.friendlyName}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            Items can be limited to values from the list this one follows. Leave an item's parent values empty to show it for every parent value.
          </span>
        </label>
        {showPresentation && dataType === "DROPDOWN" ? (
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allowMultiple} onChange={(event) => setAllowMultiple(event.target.checked)} />
              Multiple selections
            </label>
            <label className="flex items-center gap-2">
              Visible rows
              <input className="field w-20" value={visibleRows} onChange={(event) => setVisibleRows(event.target.value)} />
            </label>
          </div>
        ) : null}
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Items</span>
              <button className="btn-quiet" type="button" onClick={() => setRows([...rows, { label: "", value: "", isDefault: false, parentValues: "" }])}>
                Add item
              </button>
            </div>
            {rows.map((row, index) => (
              <div key={index} className="grid gap-2 rounded-md border border-line p-2 md:grid-cols-[1fr_1fr_auto_auto_auto]">
                <input
                  className="field"
                  placeholder="Label"
                  value={row.label}
                  onChange={(event) => updateRow(setRows, index, { label: event.target.value })}
                />
                <input
                  className="field"
                  placeholder="Stored value"
                  value={row.value}
                  onChange={(event) => updateRow(setRows, index, { value: event.target.value })}
                />
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={row.isActive !== false}
                    onChange={(event) => updateRow(setRows, index, { isActive: event.target.checked })}
                  />
                  Active
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={row.isDefault}
                    onChange={(event) => {
                      setRows((current) =>
                        current.map((item, itemIndex) => ({
                          ...item,
                          isDefault: allowMultiple
                            ? itemIndex === index
                              ? event.target.checked
                              : item.isDefault
                            : itemIndex === index && event.target.checked,
                        })),
                      );
                    }}
                  />
                  Default
                </label>
                {row.id ? (
                  <ConfirmDelete
                    id={row.id}
                    preview={previewListItemDelete}
                    commit={async (itemId) => {
                      const result = await removeListItem(itemId);
                      if (!result.error) setRows((current) => current.filter((item) => item.id !== itemId));
                      return result;
                    }}
                  />
                ) : (
                  <button className="btn-quiet" type="button" onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    Remove
                  </button>
                )}
                {parentId ? (
                  <ParentValues
                    values={row.parentValues}
                    choices={parentChoices}
                    onChange={(parentValues) => updateRow(setRows, index, { parentValues })}
                  />
                ) : null}
              </div>
            ))}
          </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-quiet" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={apply}>
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ParentValues({
  values,
  choices,
  onChange,
}: {
  values: string;
  choices: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  const selected = values.split("|").filter(Boolean);
  if (!choices.length) {
    return (
      <label className="md:col-span-5">
        <span className="label">Shown when the other list is</span>
        <input
          className="field"
          value={values}
          placeholder="Parent values, separated by |"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }
  return (
    <label className="md:col-span-5">
      <span className="label">Shown when the other list is</span>
      <select
        className="field"
        multiple
        size={Math.min(6, Math.max(3, choices.length))}
        value={selected}
        onChange={(event) => onChange([...event.target.selectedOptions].map((option) => option.value).join("|"))}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function updateRow(setRows: (value: ListItem[] | ((current: ListItem[]) => ListItem[])) => void, index: number, patch: Partial<ListItem>) {
  setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
}

function follows(peer: ListPeer, fieldId: string, peers: ListPeer[]) {
  if (!fieldId) return false;
  const byId = new Map(peers.map((item) => [item.id, item]));
  let cursor = peer.parentFieldId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === fieldId || seen.has(cursor)) return cursor === fieldId;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentFieldId ?? "";
  }
  return false;
}
