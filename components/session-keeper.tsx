"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const ACTIVITY_KEY = "edm:last-activity";
const PING_EVERY_MS = 30 * 1000;
const WARN_BEFORE_MS = 2 * 60 * 1000;
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(time: number) {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(time));
  } catch {
    // Storage can be blocked; this tab still tracks its own activity.
  }
}

/**
 * Signs this browser out after the idle limit. Typing, clicking, and scrolling count as activity
 * and are reported to the server about once a minute, so a long form does not end the sign-in.
 * Activity in any tab counts for all of them. Two minutes before the limit a notice offers to
 * stay signed in; at the limit the page goes to sign-in, which explains what happened.
 */
export function SessionKeeper({ idleMinutes }: { idleMinutes: number }) {
  const idleMs = idleMinutes * 60 * 1000;
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let lastActivity = Math.max(Date.now(), readShared());
    let lastPing = Date.now();
    let ended = false;
    writeShared(lastActivity);

    // Ends the sign-in on the server too, so the sign-in page does not send the person back in.
    const signOut = async () => {
      if (ended) return;
      ended = true;
      await fetch("/api/session", { method: "DELETE", cache: "no-store", credentials: "same-origin" }).catch(() => undefined);
      router.replace("/login?idle=1");
    };
    const ping = async () => {
      lastPing = Date.now();
      try {
        const response = await fetch("/api/session", { method: "POST", cache: "no-store", credentials: "same-origin" });
        if (response.status === 401) void signOut();
      } catch {
        // Offline for a moment; the next ping or page load checks again.
      }
    };
    const noteActivity = () => {
      lastActivity = Date.now();
      writeShared(lastActivity);
      if (lastActivity - lastPing >= PING_EVERY_MS) void ping();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACTIVITY_KEY) lastActivity = Math.max(lastActivity, Number(event.newValue) || 0);
    };
    const tick = () => {
      lastActivity = Math.max(lastActivity, readShared());
      const left = idleMs - (Date.now() - lastActivity);
      if (left <= 0) void signOut();
      else setRemaining(left <= WARN_BEFORE_MS ? left : null);
    };

    for (const name of EVENTS) window.addEventListener(name, noteActivity, { passive: true });
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(tick, 1000);
    return () => {
      for (const name of EVENTS) window.removeEventListener(name, noteActivity);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, [idleMs, router]);

  if (remaining === null) return null;
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div role="alertdialog" aria-live="assertive" aria-label="Signing out soon" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 text-sm shadow-lg">
      <p>
        You will be signed out in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} because there has been no activity.
      </p>
      {/* Clicking is itself activity, so this button only needs to exist. */}
      <button className="btn" type="button">Stay signed in</button>
    </div>
  );
}
