import { describe, expect, it } from "vitest";
import { dailyCounts, groupByRecord, timeAgo, type ChangeRow } from "@/lib/activity";

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 13, 12) - minutesAgo * 60_000);
const row = (locationId: string, attribute: string, minutesAgo: number, extra: Partial<ChangeRow> = {}): ChangeRow => ({
  locationId, fieldId: attribute, categoryId: "cat", attribute, oldValue: "a", newValue: "b", userName: "Sam", createdAt: at(minutesAgo), ...extra,
});

describe("grouping edits by record", () => {
  const rows = [row("r1", "Name", 50), row("r2", "Phone", 5), row("r1", "Email", 10, { userName: "Jordan" }), row("r1", "Salary", 1)];

  it("orders records by their latest edit and shows the newest edits first", () => {
    const groups = groupByRecord(rows, () => true, { since: null, limit: 5, perRecord: 2 });
    expect(groups.map((group) => group.locationId)).toEqual(["r1", "r2"]);
    expect(groups[0].shown.map((edit) => edit.attribute)).toEqual(["Salary", "Email"]);
    expect(groups[0].total).toBe(3);
    expect(groups[0].people).toEqual(["Sam", "Jordan"]);
  });

  it("counts edits to attributes the viewer cannot see without showing them", () => {
    const groups = groupByRecord(rows, (change) => change.attribute !== "Salary", { since: null, limit: 5, perRecord: 3 });
    expect(groups[0].hidden).toBe(1);
    expect(groups[0].shown.map((edit) => edit.attribute)).toEqual(["Email", "Name"]);
    expect(groups[0].attributes).not.toContain("Salary");
  });

  it("marks records changed since the last visit and respects the limit", () => {
    const groups = groupByRecord(rows, () => true, { since: at(7), limit: 1, perRecord: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0].isNew).toBe(true);
    expect(groupByRecord([row("r3", "Name", 60)], () => true, { since: at(7), limit: 5, perRecord: 1 })[0].isNew).toBe(false);
  });
});

describe("daily counts and times", () => {
  it("buckets dates into days, oldest first", () => {
    const now = Date.UTC(2026, 9, 13, 12);
    const counts = dailyCounts([new Date(now), new Date(now - 3600_000), new Date(now - 86_400_000), new Date(now - 40 * 86_400_000)], now, 30);
    expect(counts).toHaveLength(30);
    expect(counts[29]).toBe(2);
    expect(counts[28]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("says how long ago in plain words", () => {
    const now = at(0).getTime();
    expect(timeAgo(at(0), now)).toBe("just now");
    expect(timeAgo(at(5), now)).toBe("5 min ago");
    expect(timeAgo(at(180), now)).toBe("3 h ago");
    expect(timeAgo(at(60 * 30), now)).toBe("yesterday");
  });
});

describe("reviews of your proposals", () => {
  it("collapses a batch into one line per outcome and reviewer", async () => {
    const { summarizeReviews } = await import("@/lib/activity");
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 14, 12, minutes));
    const groups = summarizeReviews([
      ...[1, 2, 3, 4, 5].map((minute) => ({ status: "APPLIED", reviewer: "Administrator", reviewedAt: at(minute) })),
      { status: "REJECTED", reviewer: "Administrator", reviewedAt: at(9) },
    ]);
    expect(groups).toEqual([
      { status: "REJECTED", reviewer: "Administrator", count: 1, latest: at(9) },
      { status: "APPLIED", reviewer: "Administrator", count: 5, latest: at(5) },
    ]);
  });
});
