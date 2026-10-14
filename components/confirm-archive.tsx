"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { HelpTip } from "@/components/help-tip";
import { archiveRecord } from "@/lib/store-actions";

/** "Archive record" asks first, so a stray click cannot archive a record. */
export function ConfirmArchive({ locationId, label, openWorkflows }: { locationId: string; label: string; openWorkflows: number }) {
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

  return (
    <span className="inline-flex items-center">
      <button className="btn-quiet" type="button" onClick={() => setOpen(true)}>
        Archive record
      </button>
      <HelpTip text="Hides the record from the grid, exports, the share API, and AI knowledge, and pauses its open workflows. Its values and changelog are kept. Archived records are listed under Archived on the Dimension page and can be restored." />
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="panel w-full max-w-lg p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-archive-title"
            aria-describedby="confirm-archive-body"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-archive-title" className="text-lg font-semibold">Archive {label}?</h2>
            <div id="confirm-archive-body" className="mt-2 space-y-2 text-sm">
              <p>It will be hidden from the grid, exports, the share API, and AI knowledge, and it cannot be edited while archived.</p>
              {openWorkflows ? (
                <p>
                  {openWorkflows === 1 ? "Its open workflow will pause" : `Its ${openWorkflows} open workflows will pause`} until the record is restored.
                </p>
              ) : null}
              <p className="text-muted">Its values and changelog are kept, and you can restore it from Archived records.</p>
            </div>
            <form action={archiveRecord} className="mt-4 flex justify-end gap-2">
              <input type="hidden" name="locationId" value={locationId} />
              <button className="btn-quiet" type="button" onClick={() => setOpen(false)} autoFocus>
                Cancel
              </button>
              <ArchiveButton />
            </form>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function ArchiveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Archiving…" : "Yes, archive"}
    </button>
  );
}
