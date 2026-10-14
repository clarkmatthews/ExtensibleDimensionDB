"use client";

import { useEffect, useState } from "react";

const FORMATS = [
  { id: "csv", label: "CSV", detail: "Comma-separated text for spreadsheets and other systems." },
  { id: "xlsx", label: "Excel", detail: "An .xlsx workbook with one sheet." },
  { id: "json", label: "JSON", detail: "A list of records keyed by attribute, for developers and APIs." },
  { id: "xml", label: "XML", detail: "One <record> per row, with a <value key> for each attribute." },
  {
    id: "md",
    label: "Markdown",
    detail: "Every record you can view, with the schema, as knowledge cards for an AI model. Ignores the search and filters.",
  },
];

/** Export asks which format, then downloads the rows that match the current search and filters. */
export function ExportDialog({ query }: { query: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const href = (format: string) =>
    format === "md" ? "/api/stores/export-md" : `/api/stores/export?${new URLSearchParams([...new URLSearchParams(query), ["format", format]]).toString()}`;

  return (
    <>
      <button className="btn-quiet" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Export
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
          <div className="panel w-full max-w-md p-4" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="export-title" className="text-lg font-semibold">Export</h2>
            <p className="mt-1 text-sm text-muted">CSV, Excel, JSON, and XML download the rows that match the current search and filters, with the attributes you can view.</p>
            <div className="mt-3 space-y-2">
              {FORMATS.map((format, index) => (
                <a
                  key={format.id}
                  className="block rounded-md border border-line px-3 py-2 hover:border-pine hover:bg-paper focus-visible:outline-2 focus-visible:outline-pine"
                  href={href(format.id)}
                  download
                  autoFocus={index === 0}
                  onClick={() => setOpen(false)}
                >
                  <span className="font-semibold text-pine">{format.label}</span>
                  <span className="block text-xs text-muted">{format.detail}</span>
                </a>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button className="btn-quiet" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
