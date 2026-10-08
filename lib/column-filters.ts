export const BLANK_FILTER = "__blank__";
export const ALL_FILTER = "__all__";

export type ColumnFilter = { text: string; value: string };

export function readColumnFilters(
  params: Record<string, string | string[] | undefined>,
): Record<string, ColumnFilter> {
  const filters: Record<string, ColumnFilter> = {};
  for (const [key, raw] of Object.entries(params)) {
    const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    if (!value) continue;
    const kind = key.startsWith("v_") ? "value" : key.startsWith("t_") ? "text" : "";
    if (!kind) continue;
    const id = key.slice(2);
    const current = filters[id] ?? { text: "", value: "" };
    filters[id] = { ...current, [kind]: value };
  }
  return filters;
}

export function withActiveDefault(
  filters: Record<string, ColumnFilter>,
  activeFieldId: string | undefined,
  hasExplicitValue: boolean,
  checkedLabel = "Yes",
) {
  if (!activeFieldId || hasExplicitValue) return filters;
  const current = filters[activeFieldId] ?? { text: "", value: "" };
  if (current.value) return filters;
  return { ...filters, [activeFieldId]: { text: current.text, value: checkedLabel } };
}

export function filterRows<T extends { values: Record<string, string> }>(
  rows: T[],
  filters: Record<string, ColumnFilter>,
) {
  const active = Object.entries(filters).filter(([, filter]) => {
    const value = filter.value === ALL_FILTER ? "" : filter.value;
    return Boolean(filter.text.trim() || value);
  });
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every(([fieldId, filter]) => {
      const cell = row.values[fieldId] ?? "";
      if (filter.value === BLANK_FILTER) {
        if (cell.trim() !== "") return false;
      } else if (filter.value && filter.value !== ALL_FILTER && cell !== filter.value) {
        return false;
      }
      const needle = filter.text.trim().toLowerCase();
      return !needle || cell.toLowerCase().includes(needle);
    }),
  );
}

export function columnChoices(rows: { values: Record<string, string> }[], fieldIds: string[]) {
  const options: Record<string, string[]> = {};
  const blanks: Record<string, boolean> = {};
  for (const id of fieldIds) {
    const values = new Set<string>();
    let blank = false;
    for (const row of rows) {
      const cell = row.values[id] ?? "";
      if (!cell.trim()) blank = true;
      else values.add(cell);
    }
    options[id] = [...values].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
    );
    blanks[id] = blank;
  }
  return { options, blanks };
}

export function dimensionSearchParams(
  query: string,
  filters: Record<string, ColumnFilter>,
  page?: number,
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page && page > 1) params.set("page", String(page));
  for (const id of Object.keys(filters).sort()) {
    const filter = filters[id];
    if (filter?.value) params.set(`v_${id}`, filter.value);
    if (filter?.text.trim()) params.set(`t_${id}`, filter.text.trim());
  }
  return params.toString();
}

export function dimensionHref(query: string, filters: Record<string, ColumnFilter>, page = 1) {
  const search = dimensionSearchParams(query, filters, page);
  return search ? `/dimensions?${search}` : "/dimensions";
}

export function searchSuffix(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    if (value) search.set(key, value);
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}
