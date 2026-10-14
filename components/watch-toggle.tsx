import { setRecordWatch } from "@/lib/store-actions";

/**
 * An eye that follows or stops following a record. Watching is always the person's own choice:
 * other people's edits to watched records appear on their dashboard.
 */
export function WatchToggle({ locationId, watching, watcherCount }: { locationId: string; watching: boolean; watcherCount: number }) {
  const others = watcherCount - (watching ? 1 : 0);
  const label = watching ? "Stop watching this record" : "Watch this record";
  const detail = watching
    ? `You are watching: other people's edits appear on your dashboard.${others ? ` ${others} other ${others === 1 ? "person is" : "people are"} watching.` : ""}`
    : `Watch to see other people's edits to this record on your dashboard.${watcherCount ? ` ${watcherCount} ${watcherCount === 1 ? "person is" : "people are"} watching.` : ""}`;
  return (
    <form action={setRecordWatch}>
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="watch" value={watching ? "0" : "1"} />
      <button
        type="submit"
        aria-pressed={watching}
        aria-label={label}
        title={`${label}. ${detail}`}
        className={`inline-flex h-9 items-center gap-1 rounded-full px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine ${
          watching ? "bg-pine/10 text-pine hover:bg-pine/20" : "text-muted hover:bg-black/5 hover:text-ink"
        }`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill={watching ? "currentColor" : "none"} fillOpacity={watching ? 0.15 : 0} />
          <circle cx="12" cy="12" r="3" fill={watching ? "currentColor" : "none"} />
        </svg>
        {watcherCount ? <span className="tabular-nums text-xs">{watcherCount}</span> : null}
      </button>
    </form>
  );
}
