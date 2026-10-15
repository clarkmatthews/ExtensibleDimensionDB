import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { StoreGrid } from "@/components/store-grid";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { columnChoices, filterRows, readColumnFilters, withActiveDefault } from "@/lib/column-filters";
import { resolveVisibleRecordType } from "@/lib/record-access";
import { loadStoreRows, loadVisibleFields } from "@/lib/store-query";
import { checkboxCheckedText } from "@/lib/values";

export const metadata: Metadata = { title: "Dimension" };

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const page = Math.max(1, Number((typeof params.page === "string" ? params.page : "") || "1") || 1);
  const access = await loadAccess(user);
  if (!canViewModule(access, "STORES")) return <ModuleDenied />;
  const { all, types, current, rights } = await resolveVisibleRecordType(access, typeof params.type === "string" ? params.type : "");
  if (!current) {
    return (
      <p className="text-sm text-muted">
        {all.length
          ? "You do not have access to any record types. An administrator can grant it on Groups."
          : "No record types are active. An administrator can add one on Data definition."}
      </p>
    );
  }
  const fields = await loadVisibleFields(access, current.id);
  const activeField = fields.find((field) => field.isActiveFilter && field.dataType === "CHECKBOX");
  const activeChecked = activeField ? checkboxCheckedText(activeField) : "";
  const filters = withActiveDefault(
    readColumnFilters(params),
    activeField?.id,
    activeField ? `v_${activeField.id}` in params : true,
    activeChecked,
  );
  const matched = await loadStoreRows(fields, query, current.id);
  const choices = columnChoices(matched, fields.map((field) => field.id));
  const rows = filterRows(matched, filters);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const canCreate = rights.canAdd;
  // Set after a new record is saved, so the list can confirm it and link to it.
  const createdId = typeof params.created === "string" ? params.created : "";
  const createdShown = Boolean(createdId) && rows.some((row) => row.id === createdId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center text-2xl font-semibold">
            {types.length > 1 ? current.name : "Dimension"}
            <HelpTip text={`Each row is one dimension. The list shows the attributes you are allowed to view. Search looks through every visible value. Each attribute header has a value list and a Contains box, and those filters apply together.${activeField ? ` ${activeField.friendlyName} starts on ${activeChecked}.` : ""} Export uses the same filters, in CSV, Excel, JSON, or XML. Export as Markdown downloads every record you can view, including the schema, and ignores the filters.`} />
          </h1>
          <p className="text-sm text-muted">These are the attributes you are allowed to view.</p>
        </div>
        <div className="flex items-center gap-2">
          {canEditModule(access, "IMPORT") ? <Link className="btn-quiet" href={`/dimensions/import?type=${current.id}`}>Import</Link> : null}
          <Link className="btn-quiet" href="/dimensions/archived">Archived</Link>
          {canCreate ? (
            <Link className="btn" href={`/dimensions/new?type=${current.id}`}>
              New Record
            </Link>
          ) : null}
        </div>
      </div>
      {createdId ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine" role="status">
          {current.name} record created.{" "}
          <Link className="font-semibold underline" href={`/dimensions/${createdId}`}>
            Open it
          </Link>
          {createdShown ? "." : ". The list's filters hide it."}
        </p>
      ) : null}
      {types.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="Record types">
          {types.map((type) => (
            <Link
              key={type.id}
              href={`/dimensions?type=${type.id}`}
              className={type.id === current.id ? "btn" : "btn-quiet"}
              aria-current={type.id === current.id ? "page" : undefined}
            >
              {type.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <StoreGrid
        // Each record type gets its own grid, so its dimension filter and hidden columns start fresh.
        key={current.id}
        recordTypeId={types.length > 1 ? current.id : undefined}
        query={query}
        page={Math.min(page, pageCount)}
        pageCount={pageCount}
        filters={filters}
        activeFieldId={activeField?.id ?? ""}
        options={choices.options}
        blanks={choices.blanks}
        fields={fields.map((field) => ({ id: field.id, friendlyName: field.friendlyName, category: field.category.name }))}
        rows={slice.map((row) => ({ id: row.id, values: row.values }))}
      />
    </div>
  );
}
