"use client";

import { useEffect, useState } from "react";

type Preview = { error: string; title: string; message: string };

export function ConfirmDelete({
  id,
  label = "Delete",
  preview,
  commit,
  onDone,
}: {
  id: string;
  label?: string;
  preview: (id: string) => Promise<Preview>;
  commit: (id: string) => Promise<{ error: string }>;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Delete");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, open]);

  async function start() {
    setBusy(true);
    setError("");
    const result = await preview(id);
    setBusy(false);
    setTitle(result.title || "Delete");
    setMessage(result.message);
    setError(result.error);
    setOpen(true);
  }

  async function confirm() {
    setBusy(true);
    setError("");
    const result = await commit(id);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    onDone?.();
  }

  return (
    <span className="inline-flex">
      <button className="btn-quiet" type="button" onClick={() => void start()} disabled={busy && !open}>
        {label}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4">
          <div className="panel w-full max-w-lg p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title">
            <h2 id="confirm-delete-title" className="text-lg font-semibold">{title}</h2>
            {message ? <p className="mt-2 text-sm">{message}</p> : null}
            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-quiet" type="button" onClick={() => setOpen(false)} disabled={busy} autoFocus>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void confirm()} disabled={busy || !message}>
                {busy ? "Deleting…" : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
}
