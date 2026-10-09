import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { StoreGrid } from "@/components/store-grid";
import { canEditModule, canViewModule, fieldAccess, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { columnChoices, filterRows, readColumnFilters, withActiveDefault } from "@/lib/column-filters";
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
  const moduleEdit = canEditModule(access, "STORES");
  const fields = await loadVisibleFields(access);
  const activeField = fields.find((field) => field.isActiveFilter && field.dataType === "CHECKBOX");
  const activeChecked = activeField ? checkboxCheckedText(activeField) : "";
  const filters = withActiveDefault(
    readColumnFilters(params),
    activeField?.id,
    activeField ? `v_${activeField.id}` in params : true,
    activeChecked,
  );
  const matched = await loadStoreRows(fields, query);
  const choices = columnChoices(matched, fields.map((field) => field.id));
  const rows = filterRows(matched, filters);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const canCreate = moduleEdit && (user.isAdmin || fields.some((field) => fieldAccess(access, field.id, field.categoryId).canUpdate));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center text-2xl font-semibold">
            Dimension
            <HelpTip text={`Each row is one dimension. The list shows the attributes you are allowed to view. Search looks through every visible value. Each attribute header has a value list and a Contains box, and those filters apply together.${activeField ? ` ${activeField.friendlyName} starts on ${activeChecked}.` : ""} Export CSV uses the same filters. Export MD downloads every record you can view, including the schema, and ignores the filters.`} />
          </h1>
          <p className="text-sm text-muted">These are the attributes you are allowed to view.</p>
        </div>
        <div className="flex items-center gap-2">
          {canEditModule(access, "IMPORT") ? <Link className="btn-quiet" href="/dimensions/import">Import</Link> : null}
          <Link className="btn-quiet" href="/dimensions/archived">Archived</Link>
          {canCreate ? (
            <Link className="btn" href="/dimensions/new">
              New Record
            </Link>
          ) : null}
        </div>
      </div>
      <StoreGrid
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
