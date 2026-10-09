import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import type { ApplyResult, ColumnStatus, ImportSummary } from "@/lib/import";
import { MAX_IMPORT_ROWS } from "@/lib/import";
import { applyImport, uploadImport } from "@/lib/import-actions";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Import" };

const COLUMN_TEXT: Record<ColumnStatus, string> = {
  matched: "Imported",
  identifier: "Identifier: matches existing records",
  unknown: "No matching attribute; ignored",
  ambiguous: "Matches several attributes; use the attribute key; ignored",
  "read-only": "You cannot update this attribute; ignored",
  automatic: "Filled in automatically; ignored",
};

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "IMPORT")) return <ModuleDenied />;
  const canImport = canEditModule(access, "IMPORT") && canEditModule(access, "STORES");
  const params = await searchParams;
  const job = params.job ? await prisma.importJob.findUnique({ where: { id: params.job } }) : null;
  const mine = job && job.userId === user.id ? job : null;
  const summary = mine?.summary as (ImportSummary & { result?: ApplyResult }) | null;

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm font-semibold text-pine" href="/dimensions">Dimension</Link>
        <h1 className="mt-1 flex items-center text-2xl font-semibold">
          Import
          <HelpTip text="Create and update records from a CSV file. Every row is checked with the same rules as the record form before anything is saved." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The first row names the attributes, by key or display name. Export CSV produces a file in this format.
          When the file has the unique identifier column, rows that match an existing record update it; other rows create records.
          Empty cells clear a value; leave a column out to keep its values. Up to {MAX_IMPORT_ROWS} rows and 5 MB per file.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {!canImport ? <p className="text-sm text-muted">Importing needs edit access to Import and to Dimension.</p> : null}

      {canImport && (!mine || mine.status === "APPLIED") ? (
        <form action={uploadImport} className="panel flex flex-wrap items-end gap-3 p-4">
          <label>
            <span className="label">CSV file</span>
            <input className="field" type="file" name="file" accept=".csv,text/csv" required />
          </label>
          <button className="btn" type="submit">Check file</button>
        </form>
      ) : null}

      {mine && summary ? (
        <section className="panel space-y-4 p-4">
          <h2 className="text-lg font-semibold">{mine.fileName}</h2>
          {summary.fatal ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{summary.fatal}</p> : null}

          {summary.result ? (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">
              Imported: {summary.result.created} created, {summary.result.updated} updated, {summary.result.unchanged} unchanged
              {summary.result.failed.length ? `, ${summary.result.failed.length} skipped` : ""}.
            </div>
          ) : !summary.fatal ? (
            <p className="text-sm">
              {summary.totalRows} rows: <strong>{summary.create}</strong> to create, <strong>{summary.update}</strong> to update,{" "}
              {summary.unchanged} unchanged, <strong className={summary.errors ? "text-danger" : ""}>{summary.errors}</strong> with errors.
              {summary.identifier ? ` Existing records are matched by ${summary.identifier}.` : " The file has no unique identifier column, so every row creates a record."}
            </p>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold">Columns</h3>
            <ul className="mt-1 space-y-0.5 text-sm">
              {summary.columns.map((column) => (
                <li key={column.index}>
                  <span className="font-mono">{column.header || "(blank)"}</span>
                  {column.field ? <span className="text-muted"> → {column.field}</span> : null}
                  <span className={column.status === "matched" || column.status === "identifier" ? " text-pine" : " text-muted"}> · {COLUMN_TEXT[column.status]}</span>
                </li>
              ))}
            </ul>
          </div>

          {(summary.result?.failed.length ?? summary.errorRows.length) ? (
            <div>
              <h3 className="text-sm font-semibold">{summary.result ? "Skipped rows" : "Rows with errors (skipped on import)"}</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {(summary.result
                  ? summary.result.failed.map((item) => ({ row: item.row, label: "", messages: [item.message] }))
                  : summary.errorRows
                ).map((item) => (
                  <li key={item.row}>
                    Row {item.row}{item.label ? ` (${item.label})` : ""}: <span className="text-danger">{item.messages.join(" ")}</span>
                  </li>
                ))}
              </ul>
              {!summary.result && summary.errors > summary.errorRows.length ? (
                <p className="mt-1 text-xs text-muted">Showing the first {summary.errorRows.length} of {summary.errors}.</p>
              ) : null}
            </div>
          ) : null}

          {canImport && mine.status === "PREVIEWED" && !summary.fatal && summary.create + summary.update > 0 ? (
            <form action={applyImport} className="flex flex-wrap items-center gap-4">
              <input type="hidden" name="job" value={mine.id} />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="runWorkflows" />
                Run workflows for imported changes
                <HelpTip text="Off by default, so a large import does not send a notification or open an action for every row. Changes are always written to the Changelog, and webhooks are always sent." />
              </label>
              <button className="btn" type="submit">
                Import {summary.create + summary.update} rows
              </button>
              <Link className="btn-quiet" href="/dimensions/import">Cancel</Link>
            </form>
          ) : null}
          {mine.status === "PREVIEWED" && (summary.fatal || summary.create + summary.update === 0) ? (
            <Link className="btn-quiet" href="/dimensions/import">Choose another file</Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
