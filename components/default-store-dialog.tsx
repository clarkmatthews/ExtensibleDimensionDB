"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyDefaultToStores, loadStoreTargets } from "@/lib/definition-actions";
import type { StoreNode } from "@/lib/store-targets";

function locationIdsIn(node: StoreNode): string[] {
  if (node.locationId) return [node.locationId];
  return node.children.flatMap(locationIdsIn);
}

export function DefaultStoreDialog({
  fieldId,
  value,
  onClose,
}: {
  fieldId: string;
  value: string;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<StoreNode[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadStoreTargets(fieldId).then((loaded) => {
      if (!cancelled) setNodes(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [fieldId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const visible = useMemo(() => filterTree(nodes ?? [], query), [nodes, query]);
  const allIds = useMemo(() => (nodes ?? []).flatMap(locationIdsIn), [nodes]);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggle(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    setError("");
    const result = await applyDefaultToStores(fieldId, [...selected], value);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setApplied(result.applied);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="panel flex max-h-[80vh] w-full max-w-lg flex-col p-4" role="dialog" aria-modal="true" aria-labelledby="store-default-title">
        <h2 id="store-default-title" className="text-lg font-semibold">Dimensions</h2>
        <p className="mt-1 text-sm text-muted">
          Apply <span className="font-medium text-ink">{value || "an empty value"}</span> to the dimensions you check. Checking a state or city selects every dimension under it.
        </p>
        <input
          className="field mt-3"
          value={query}
          placeholder="Search dimensions"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {nodes === null ? <p className="text-sm text-muted">Loading dimensions…</p> : null}
          {nodes && allIds.length === 0 ? <p className="text-sm text-muted">There are no dimensions yet.</p> : null}
          {nodes && allIds.length > 0 ? (
            <>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => toggle(allIds, !allChecked)}
                />
                All dimensions
              </label>
              <ul className="space-y-2">
                {visible.map((node) => (
                  <StoreCheck key={node.id} node={node} selected={selected} onToggle={toggle} />
                ))}
              </ul>
            </>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {applied > 0 ? (
          <p className="mt-3 text-sm text-pine">Applied to {applied} {applied === 1 ? "dimension" : "dimensions"}.</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-quiet" type="button" onClick={onClose} disabled={busy}>
            {applied > 0 ? "Done" : "Don't apply"}
          </button>
          <button className="btn" type="button" onClick={() => void apply()} disabled={busy || selected.size === 0 || nodes === null}>
            {busy ? "Applying…" : "Apply to selected"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StoreCheck({
  node,
  selected,
  onToggle,
}: {
  node: StoreNode;
  selected: Set<string>;
  onToggle: (ids: string[], on: boolean) => void;
}) {
  const ids = locationIdsIn(node);
  const checked = ids.length > 0 && ids.every((id) => selected.has(id));
  const partial = !checked && ids.some((id) => selected.has(id));
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = partial;
  }, [partial]);

  return (
    <li>
      <label className="flex items-start gap-2 text-sm">
        <input ref={box} type="checkbox" checked={checked} onChange={() => onToggle(ids, !checked)} />
        <span>
          {node.label}
          {node.hint ? <span className="ml-2 text-muted">{node.hint}</span> : null}
        </span>
      </label>
      {node.children.length ? (
        <ul className="mt-1 space-y-1 border-l border-line pl-4">
          {node.children.map((child) => (
            <StoreCheck key={child.id} node={child} selected={selected} onToggle={onToggle} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function filterTree(nodes: StoreNode[], query: string): StoreNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, needle);
    const self = node.label.toLowerCase().includes(needle);
    if (!self && children.length === 0) return [];
    return [{ ...node, children: self ? node.children : children }];
  });
}
