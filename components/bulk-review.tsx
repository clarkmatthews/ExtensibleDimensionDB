"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { reviewAllProposals } from "@/lib/proposal-actions";

/** Approve all or Reject all: one confirmation covers every proposal this person can review. */
export function BulkReview({ ids, waiting }: { ids: string[]; waiting: number }) {
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const count = ids.length;
  const plural = count === 1 ? "proposal" : "proposals";
  const others = waiting - count;

  useEffect(() => {
    if (!decision) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDecision(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [decision]);

  return (
    <div className="panel flex flex-wrap items-end gap-3 p-4 text-sm">
      <label className="min-w-56 flex-1">
        <span className="label">Note for all (optional)</span>
        <input className="field" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button className="btn" type="button" onClick={() => setDecision("approve")}>
        Approve all ({count})
      </button>
      <button className="btn-quiet" type="button" onClick={() => setDecision("reject")}>
        Reject all ({count})
      </button>
      {others > 0 ? (
        <p className="w-full text-xs text-muted">
          {others === 1 ? "1 other proposal is" : `${others} other proposals are`} not included because you cannot review {others === 1 ? "it" : "them"}, for example one made with your own token.
        </p>
      ) : null}
      {decision ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4" onClick={() => setDecision(null)}>
          <div
            className="panel w-full max-w-lg p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="bulk-review-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="bulk-review-title" className="text-lg font-semibold">
              {decision === "approve" ? `Approve and save all ${count} ${plural}?` : `Reject all ${count} ${plural}?`}
            </h2>
            <p className="mt-2 text-sm">
              {decision === "approve"
                ? "All of them are saved now, oldest first, with no further prompts. Each is checked like a single approval and runs workflows and webhooks; one that can no longer be applied is marked failed, and the rest still go ahead."
                : "All of them are rejected now, with no further prompts. Nothing is saved, and each person who made a proposal is notified."}
            </p>
            {note ? <p className="mt-2 text-sm text-muted">Note: {note}</p> : null}
            <form action={reviewAllProposals} className="mt-4 flex justify-end gap-2">
              {ids.map((id) => <input key={id} type="hidden" name="id" value={id} />)}
              <input type="hidden" name="note" value={note} />
              <input type="hidden" name="decision" value={decision} />
              <button className="btn-quiet" type="button" onClick={() => setDecision(null)} autoFocus>
                Cancel
              </button>
              <ConfirmButton label={decision === "approve" ? "Yes, approve all" : "Yes, reject all"} busy={decision === "approve" ? "Approving…" : "Rejecting…"} />
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConfirmButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}
