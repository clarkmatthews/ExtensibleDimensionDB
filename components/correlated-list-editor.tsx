"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { choicesForParent } from "@/lib/list-correlation";
import { addListItem, previewListItemDelete, removeListItem, searchListItems, updateListItem } from "@/lib/list-actions";

type CatalogList = {
  id: string;
  name: string;
  parentListId: string;
  items: { label: string; value: string }[];
};

type Row = { id: string; label: string; value: string; isActive: boolean };

function ancestorChain(parentId: string, lists: CatalogList[]) {
  const chain: CatalogList[] = [];
  const seen = new Set<string>();
  let cursor = lists.find((list) => list.id === parentId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    const parent = cursor.parentListId;
    cursor = lists.find((list) => list.id === parent);
  }
  return chain;
}

function blockedParents(listId: string, lists: CatalogList[]) {
  const blocked = new Set<string>([listId]);
  const queue = [listId];
  while (queue.length) {
    const current = queue.shift() ?? "";
    for (const list of lists) {
      if (list.parentListId === current && !blocked.has(list.id)) {
        blocked.add(list.id);
        queue.push(list.id);
      }
    }
  }
  return blocked;
}

export function CorrelatedListEditor({
  listId,
  listName,
  description,
  parentListId,
  lists,
  onClose,
  onSaveDetails,
}: {
  listId: string;
  listName: string;
  description: string;
  parentListId: string;
  lists: CatalogList[];
  onClose: () => void;
  onSaveDetails: (next: { name: string; description: string; parentListId: string }) => Promise<string | void>;
}) {
  const [name, setName] = useState(listName);
  const [notes, setNotes] = useState(description);
  const [parentId, setParentId] = useState(parentListId);
  const [picks, setPicks] = useState<string[]>(() => defaultPicks(ancestorChain(parentListId, lists)));
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const saved = useRef(new Map<string, { label: string; value: string; isActive: boolean }>());
  const ancestors = useMemo(() => ancestorChain(parentId, lists), [lists, parentId]);
  const parentValue = picks[ancestors.length - 1] ?? "";
  const blocked = useMemo(() => blockedParents(listId, lists), [listId, lists]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // When the chain of parent lists changes, start the parent choices over. This adjusts state
  // during render (the pattern React recommends) instead of in an effect.
  const chainKey = ancestors.map((node) => node.id).join("\n");
  const [picksForChain, setPicksForChain] = useState(chainKey);
  if (picksForChain !== chainKey) {
    setPicksForChain(chainKey);
    setPicks(defaultPicks(ancestors));
    setQuery("");
    setRows([]);
    setTotal(0);
  }

  // Rows are cleared by whatever changes the parent or the search, then fetched here after a pause.
  useEffect(() => {
    let cancel = false;
    const timer = window.setTimeout(async () => {
      if (!parentValue) return;
      const result = await searchListItems(listId, parentValue, query);
      if (cancel) return;
      saved.current = new Map(result.items.map((item) => [item.id, { label: item.label, value: item.value, isActive: item.isActive }]));
      setRows(result.items);
      setTotal(result.total);
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [listId, parentValue, query]);

  function choose(index: number, value: string) {
    setPicks((current) => current.map((pick, itemIndex) => (itemIndex === index ? value : itemIndex > index ? "" : pick)));
    setQuery("");
    setRows([]);
    setTotal(0);
  }

  async function addItem() {
    const added = draft.trim();
    const message = await addListItem(listId, parentValue, added);
    if (message.error) {
      setError(message.error);
      return;
    }
    setDraft("");
    setError("");
    setQuery(added);
    if (query !== added) {
      setRows([]);
      setTotal(0);
    } else {
      const result = await searchListItems(listId, parentValue, added);
      saved.current = new Map(result.items.map((item) => [item.id, { label: item.label, value: item.value, isActive: item.isActive }]));
      setRows(result.items);
      setTotal(result.total);
    }
  }

  async function commit(row: Row) {
    const label = row.label.trim();
    const value = row.value.trim() || label;
    if (!label) return;
    const previous = saved.current.get(row.id);
    if (previous && previous.label === label && previous.value === value && previous.isActive === row.isActive) return;
    const result = await updateListItem(row.id, label, value, row.isActive);
    setError(result.error);
    if (!result.error) saved.current.set(row.id, { label, value, isActive: row.isActive });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="panel flex max-h-[85vh] w-full max-w-3xl flex-col p-4" role="dialog" aria-modal="true" aria-labelledby="correlated-list-title">
        <h2 id="correlated-list-title" className="text-lg font-semibold">Correlated items</h2>
        <p className="mt-1 text-sm text-muted">
          This list follows another list. Pick a value from that list, then add the items that should appear for it. If that list follows one too, pick each parent from the top of the chain down.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label>
            <span className="label">Name</span>
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span className="label">Description</span>
            <input className="field" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="label">Follows</span>
          <select
            className="field"
            value={parentId}
            onChange={(event) => {
              setParentId(event.target.value);
              setRows([]);
              setTotal(0);
            }}
          >
            <option value="">No other list</option>
            {lists
              .filter((list) => !blocked.has(list.id))
              .map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
          </select>
        </label>
        {ancestors.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Choose the list this one follows, then save. Items can be correlated to that list after it is saved.</p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {ancestors.map((node, index) => (
                <ParentPick
                  key={node.id}
                  node={node}
                  previous={index === 0 ? "" : picks[index - 1] ?? ""}
                  value={picks[index] ?? ""}
                  onChange={(value) => choose(index, value)}
                />
              ))}
              <label>
                <span className="label">Find an item</span>
                <input className="field" value={query} placeholder="Search the selected value" onChange={(event) => {
                  setQuery(event.target.value);
                  setRows([]);
                  setTotal(0);
                }} />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="field"
                value={draft}
                placeholder={parentValue ? `Add an item for ${parentValue}` : "Choose each parent value first"}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addItem();
                  }
                }}
              />
              <button className="btn" type="button" onClick={() => void addItem()} disabled={!parentValue || !draft.trim()}>
                Add item
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {parentValue ? `${total} ${total === 1 ? "item" : "items"} for ${parentValue}. Showing ${rows.length}.` : "Choose each parent value to see its items."}
            </p>
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {rows.map((row) => (
                <div key={row.id} className="grid gap-2 rounded-md border border-line p-2 md:grid-cols-[1fr_1fr_auto_auto]">
                  <input
                    className="field"
                    value={row.label}
                    aria-label="Label"
                    onChange={(event) => setRows((current) => current.map((item) => (item.id === row.id ? { ...item, label: event.target.value } : item)))}
                    onBlur={(event) => void commit({ ...row, label: event.target.value })}
                  />
                  <input
                    className="field"
                    value={row.value}
                    aria-label="Stored value"
                    onChange={(event) => setRows((current) => current.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)))}
                    onBlur={(event) => void commit({ ...row, value: event.target.value })}
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(event) => {
                        const next = { ...row, isActive: event.target.checked };
                        setRows((current) => current.map((item) => (item.id === row.id ? next : item)));
                        void commit(next);
                      }}
                    />
                    Active
                  </label>
                  <ConfirmDelete
                    id={row.id}
                    preview={previewListItemDelete}
                    commit={removeListItem}
                    onDone={() => {
                      void searchListItems(listId, parentValue, query).then((next) => {
                        saved.current = new Map(next.items.map((item) => [item.id, { label: item.label, value: item.value, isActive: item.isActive }]));
                        setRows(next.items);
                        setTotal(next.total);
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-quiet" type="button" onClick={onClose}>
            Close
          </button>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              const message = await onSaveDetails({ name: name.trim(), description: notes.trim(), parentListId: parentId });
              if (message) setError(message);
              else onClose();
            }}
          >
            Save list
          </button>
        </div>
      </div>
    </div>
  );
}

function ParentPick({
  node,
  previous,
  value,
  onChange,
}: {
  node: CatalogList;
  previous: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<{ label: string; value: string }[]>([]);
  const loaded = node.items.length > 0;
  const waitingForParent = !previous && Boolean(node.parentListId);
  const choices = loaded
    ? previous
      ? choicesForParent(
          node.items.map((item) => ({ ...item, parentValues: "" })),
          previous,
          false,
        )
      : node.items
    : waitingForParent
      ? []
      : found;

  useEffect(() => {
    if (loaded || waitingForParent) return;
    let cancel = false;
    const timer = window.setTimeout(async () => {
      const result = await searchListItems(node.id, previous, term);
      if (cancel) return;
      setFound(result.items.map((item) => ({ label: item.label, value: item.value })));
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [loaded, waitingForParent, node.id, previous, term]);

  return (
    <label>
      <span className="label">{node.name}</span>
      {loaded ? null : (
        <input className="field mb-2" value={term} placeholder={`Find a ${node.name} value`} onChange={(event) => setTerm(event.target.value)} />
      )}
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{loaded ? "" : `Choose ${node.name}`}</option>
        {value && !choices.some((item) => item.value === value) ? <option value={value}>{value}</option> : null}
        {choices.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The starting parent choices: the first item of a loaded top-level list, blank otherwise. */
function defaultPicks(chain: CatalogList[]) {
  return chain.map((node, index) => (index > 0 || node.items.length === 0 ? "" : node.items[0]?.value ?? ""));
}
