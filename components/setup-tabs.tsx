"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CopyButton } from "@/components/copy-button";

export type SetupTab = { id: string; label: string; intro: string; code: string; note?: string };

/** One setup snippet at a time, with tabs to switch between clients. */
export function SetupTabs({ tabs }: { tabs: SetupTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  if (!current) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === current.id);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    setActive(tabs[next].id);
    buttons.current[next]?.focus();
  }

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Setup instructions" className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => {
          const selected = tab.id === current.id;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${selected ? "bg-white text-pine shadow-sm" : "text-slate-600 hover:text-pine"}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${current.id}`} className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">{current.intro}</p>
          <CopyButton value={current.code} />
        </div>
        <pre className="overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs leading-relaxed">{current.code}</pre>
        {current.note ? <p className="text-xs text-slate-600">{current.note}</p> : null}
      </div>
    </div>
  );
}
