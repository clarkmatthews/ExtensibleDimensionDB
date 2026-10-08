"use client";

import { useEffect, useId, useRef, useState } from "react";

export function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    function placeTip() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const below = rect.bottom + 8;
      setPlace({ top: below + 180 > window.innerHeight ? Math.max(8, rect.top - 168) : below, left });
    }
    placeTip();
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", placeTip);
    window.addEventListener("scroll", placeTip, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", placeTip);
      window.removeEventListener("scroll", placeTip, true);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="inline-flex">
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={open ? tipId : undefined}
        aria-label="Help"
        className="help-mark"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        ?
      </span>
      {open ? (
        <span id={tipId} role="tooltip" className="help-pop" style={{ top: place.top, left: place.left }}>
          {text}
        </span>
      ) : null}
    </span>
  );
}
