"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from "@tanstack/react-table";
import { HelpTip } from "@/components/help-tip";
import {
  ALL_FILTER,
  BLANK_FILTER,
  dimensionHref,
  dimensionSearchParams,
  type ColumnFilter,
} from "@/lib/column-filters";

export type GridRow = { id: string; values: Record<string, string> };

function textsFromFilters(fields: { id: string }[], filters: Record<string, ColumnFilter>) {
  return Object.fromEntries(fields.map((field) => [field.id, filters[field.id]?.text ?? ""]));
}

export function StoreGrid({
  fields,
  rows,
  query,
  page,
  pageCount,
  filters,
  options,
  blanks,
  activeFieldId,
}: {
  fields: { id: string; friendlyName: string; category: string }[];
  rows: GridRow[];
  query: string;
  page: number;
  pageCount: number;
  filters: Record<string, ColumnFilter>;
  options: Record<string, string[]>;
  blanks: Record<string, boolean>;
  activeFieldId: string;
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [category, setCategory] = useState("all");
  const [texts, setTexts] = useState<Record<string, string>>(() => textsFromFilters(fields, filters));
  const sentTexts = useRef(textsFromFilters(fields, filters));
  const categories = [...new Set(fields.map((field) => field.category))];
  const filtering =
    Boolean(query.trim()) ||
    Object.values(filters).some((filter) => filter.text.trim() || (filter.value && filter.value !== ALL_FILTER));
  const columns = useMemo<ColumnDef<GridRow>[]>(
    () => [
      {
        id: "open",
        header: "",
        cell: ({ row }) => (
          <Link className="font-semibold text-pine" href={`/dimensions/${row.original.id}`}>
            Open
          </Link>
        ),
      },
      ...fields.map((field) => ({
        id: field.id,
        header: field.friendlyName,
        accessorFn: (row: GridRow) => row.values[field.id] ?? "",
      })),
    ],
    [fields],
  );
  const columnVisibility = {
    ...visibility,
    ...Object.fromEntries(
      fields.filter((field) => category !== "all" && field.category !== category).map((field) => [field.id, false]),
    ),
  };
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
  });
  const filtersKey = JSON.stringify(filters);
  const fieldKey = fields.map((field) => field.id).join(",");

  useEffect(() => {
    const serverTexts = textsFromFilters(fields, filters);
    setTexts((current) => {
      let changed = false;
      const next = { ...current };
      for (const field of fields) {
        const local = (current[field.id] ?? "").trim();
        const remote = serverTexts[field.id] ?? "";
        const sent = (sentTexts.current[field.id] ?? "").trim();
        if (local !== remote && local !== sent) continue;
        if ((current[field.id] ?? "") !== remote) {
          next[field.id] = remote;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [filtersKey, fieldKey, fields, filters]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const serverTexts = textsFromFilters(fields, filters);
      const changed = fields.some(
        (field) => (texts[field.id] ?? "").trim() !== (serverTexts[field.id] ?? "").trim(),
      );
      if (!changed) return;
      const next: Record<string, ColumnFilter> = { ...filters };
      const pushed: Record<string, string> = {};
      for (const field of fields) {
        const text = (texts[field.id] ?? "").trim();
        const value = filters[field.id]?.value ?? "";
        pushed[field.id] = text;
        if (!text && !value) delete next[field.id];
        else next[field.id] = { text, value };
      }
      sentTexts.current = pushed;
      router.push(dimensionHref(query, next, 1), { scroll: false });
    }, 300);
    return () => clearTimeout(handle);
  }, [texts, filters, fields, query, router]);

  function chooseValue(fieldId: string, value: string) {
    const chosen = value === "" && fieldId === activeFieldId ? ALL_FILTER : value;
    const next: Record<string, ColumnFilter> = { ...filters };
    const pushed: Record<string, string> = {};
    for (const field of fields) {
      const text = (texts[field.id] ?? filters[field.id]?.text ?? "").trim();
      const selected = field.id === fieldId ? chosen : (filters[field.id]?.value ?? "");
      pushed[field.id] = text;
      if (!text && !selected) delete next[field.id];
      else next[field.id] = { text, value: selected };
    }
    sentTexts.current = pushed;
    router.push(dimensionHref(query, next, 1), { scroll: false });
  }

  const exportQuery = dimensionSearchParams(query, filters);

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2" action="/dimensions">
        <input className="field max-w-sm" name="q" defaultValue={query} placeholder="Search dimension values" />
        <input type="hidden" name="page" value="1" />
        {Object.entries(filters).map(([id, filter]) => (
          <span key={id}>
            {filter.value ? <input type="hidden" name={`v_${id}`} value={filter.value} /> : null}
            {filter.text ? <input type="hidden" name={`t_${id}`} value={filter.text} /> : null}
          </span>
        ))}
        <button className="btn" type="submit">Search</button>
        <a className="btn-quiet" href={`/api/stores/export${exportQuery ? `?${exportQuery}` : ""}`}>Export CSV</a>
        <a className="btn-quiet" href="/api/stores/export-md">Export MD</a>
        <HelpTip text="Search matches any visible value. Export CSV downloads the rows that match the search and the attribute filters. Export MD downloads every record you can view, as knowledge cards, and ignores those filters." />
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="inline-flex items-center">
          Dimension
          <HelpTip text="Shows only the attributes in the chosen dimension. Rows stay in the list." />
          <select className="field ml-2 w-auto" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All</option>
            {categories.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <details>
          <summary className="inline-flex cursor-pointer items-center text-pine">
            Attributes
            <HelpTip text="Choose which attributes appear. A hidden attribute is still included in search and export." />
          </summary>
          <div className="mt-2 grid max-h-48 gap-1 overflow-auto rounded-md border border-line bg-white p-3">
            {fields.map((field) => (
              <label key={field.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={columnVisibility[field.id] !== false}
                  onChange={(event) =>
                    setVisibility((current) => ({ ...current, [field.id]: event.target.checked }))
                  }
                />
                {field.friendlyName}
              </label>
            ))}
          </div>
        </details>
      </div>
      <div className="panel overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const field = fields.find((item) => item.id === header.column.id);
                  return (
                    <th key={header.id} className="align-top px-3 py-2">
                      <div className="whitespace-nowrap font-semibold">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </div>
                      {field ? (
                        <div className="mt-2 grid min-w-36 gap-1">
                          <select
                            className="field px-2 py-1 text-xs"
                            aria-label={`${field.friendlyName} values`}
                            value={(filters[field.id]?.value ?? "") === ALL_FILTER ? "" : (filters[field.id]?.value ?? "")}
                            onChange={(event) => chooseValue(field.id, event.target.value)}
                          >
                            <option value="">All</option>
                            {blanks[field.id] ? <option value={BLANK_FILTER}>(Blank)</option> : null}
                            {(options[field.id] ?? []).map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                          <input
                            className="field px-2 py-1 text-xs"
                            aria-label={`Filter ${field.friendlyName}`}
                            placeholder="Contains"
                            value={texts[field.id] ?? ""}
                            onChange={(event) =>
                              setTexts((current) => ({ ...current, [field.id]: event.target.value }))
                            }
                          />
                        </div>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-muted" colSpan={table.getVisibleLeafColumns().length}>
                  {filtering ? "No dimensions match these filters." : "No dimensions yet."}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="whitespace-nowrap px-3 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 text-sm">
        {page > 1 ? <a className="btn-quiet" href={dimensionHref(query, filters, page - 1)}>Previous</a> : null}
        <span className="self-center text-muted">Page {page} of {pageCount}</span>
        {page < pageCount ? <a className="btn-quiet" href={dimensionHref(query, filters, page + 1)}>Next</a> : null}
      </div>
    </div>
  );
}
