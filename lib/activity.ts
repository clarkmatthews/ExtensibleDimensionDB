import { canEditModule, canSeeValue, canViewModule, type AccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { recordLabels } from "@/lib/record-types";

const DAY = 24 * 60 * 60 * 1000;

export type ChangeRow = {
  locationId: string;
  fieldId: string;
  categoryId: string;
  attribute: string;
  oldValue: string;
  newValue: string;
  userName: string;
  createdAt: Date;
};

/** One record's edits, newest first. Values the viewer may not see are counted, never shown. */
export type RecordActivity = {
  locationId: string;
  label: string;
  typeName: string;
  latestAt: Date;
  people: string[];
  shown: { attribute: string; oldValue: string; newValue: string; userName: string; createdAt: Date }[];
  attributes: string[];
  hidden: number;
  total: number;
  isNew: boolean;
};

/**
 * Groups edits by record, keeping records in order of their latest edit.
 * `canSee` decides whether a value may be shown; a hidden edit counts but shows nothing.
 */
export function groupByRecord(
  rows: ChangeRow[],
  canSee: (row: ChangeRow) => boolean,
  options: { since: Date | null; limit: number; perRecord: number },
): Omit<RecordActivity, "label" | "typeName">[] {
  const groups = new Map<string, Omit<RecordActivity, "label" | "typeName">>();
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const row of sorted) {
    let group = groups.get(row.locationId);
    if (!group) {
      if (groups.size >= options.limit) continue;
      group = { locationId: row.locationId, latestAt: row.createdAt, people: [], shown: [], attributes: [], hidden: 0, total: 0, isNew: false };
      groups.set(row.locationId, group);
    }
    group.total += 1;
    if (options.since && row.createdAt > options.since) group.isNew = true;
    if (!group.people.includes(row.userName)) group.people.push(row.userName);
    if (!canSee(row)) {
      group.hidden += 1;
      continue;
    }
    if (!group.attributes.includes(row.attribute)) group.attributes.push(row.attribute);
    if (group.shown.length < options.perRecord) {
      group.shown.push({ attribute: row.attribute, oldValue: row.oldValue, newValue: row.newValue, userName: row.userName, createdAt: row.createdAt });
    }
  }
  return [...groups.values()];
}

/** Counts per day for the last `days` days, oldest first; days are UTC calendar days. */
export function dailyCounts(dates: Date[], now: number, days: number) {
  const today = Math.floor(now / DAY);
  const counts = new Array<number>(days).fill(0);
  for (const date of dates) {
    const index = days - 1 - (today - Math.floor(date.getTime() / DAY));
    if (index >= 0 && index < days) counts[index] += 1;
  }
  return counts;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export function timeAgo(date: Date, now: number) {
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return date.toLocaleDateString();
}

const toRow = (change: {
  locationId: string;
  fieldId: string;
  oldValue: string;
  newValue: string;
  createdAt: Date;
  field: { friendlyName: string; categoryId: string };
  user: { name: string };
}): ChangeRow => ({
  locationId: change.locationId,
  fieldId: change.fieldId,
  categoryId: change.field.categoryId,
  attribute: change.field.friendlyName,
  oldValue: change.oldValue,
  newValue: change.newValue,
  userName: change.user.name,
  createdAt: change.createdAt,
});

const changeInclude = { field: { select: { friendlyName: true, categoryId: true } }, user: { select: { name: true } } } as const;

async function withLabels(groups: Omit<RecordActivity, "label" | "typeName">[]): Promise<RecordActivity[]> {
  const ids = groups.map((group) => group.locationId);
  const [labels, locations] = await Promise.all([
    recordLabels(ids),
    prisma.location.findMany({ where: { id: { in: ids } }, select: { id: true, recordType: { select: { name: true } } } }),
  ]);
  return groups.map((group) => ({
    ...group,
    label: labels.get(group.locationId) ?? group.locationId,
    typeName: locations.find((location) => location.id === group.locationId)?.recordType.name ?? "",
  }));
}

export type Attention = {
  overdue: number;
  dueSoon: number;
  pendingProposals: number;
  /** Reviews since the last visit, one entry per outcome and reviewer. */
  reviewedProposals: { status: string; reviewer: string; count: number; latest: Date }[];
  watchedChanged: number;
};

export type DashboardActivity = {
  stats: { edits: number; records: number; completed: number; overdue: number };
  sparkline: number[];
  attention: Attention;
  watched: RecordActivity[];
  watchingCount: number;
  mine: RecordActivity[];
};

/**
 * Everything the dashboard shows beyond open actions: counts for the last 7 days, a 30-day edit
 * history, what needs attention, other people's edits to records this person watches, and their
 * own recent edits. Values follow the viewer's permissions.
 */
export async function loadDashboardActivity(input: {
  access: AccessContext;
  /** When they last opened the dashboard, before this visit. */
  since: Date | null;
  now: number;
  openTasks: { deadlineAt: Date }[];
}): Promise<DashboardActivity> {
  const { access, since, now } = input;
  const userId = access.user.id;
  const week = new Date(now - 7 * DAY);
  const month = new Date(now - 30 * DAY);
  const canSeeRecords = canViewModule(access, "STORES");
  const canSee = (row: ChangeRow) => canSeeValue(access, row.fieldId, row.categoryId);
  const reviewsProposals = canEditModule(access, "PROPOSALS");

  const [myRecent, myDates, completed, watches, pendingProposals, reviewed] = await Promise.all([
    canSeeRecords
      ? prisma.fieldChange.findMany({
          where: { userId, createdAt: { gte: new Date(now - 14 * DAY) }, location: { isActive: true } },
          include: changeInclude,
          orderBy: { createdAt: "desc" },
          take: 300,
        })
      : Promise.resolve([]),
    prisma.fieldChange.findMany({ where: { userId, createdAt: { gte: month } }, select: { createdAt: true, locationId: true } }),
    prisma.taskEvent.count({ where: { userId, action: "DONE", createdAt: { gte: week } } }),
    canSeeRecords ? prisma.recordWatch.findMany({ where: { userId, location: { isActive: true } }, select: { locationId: true } }) : Promise.resolve([]),
    reviewsProposals
      ? prisma.changeProposal.count({
          where: { status: "PENDING", ...(access.user.isAdmin ? {} : { proposedById: { not: userId } }) },
        })
      : Promise.resolve(0),
    // Reviews of this person's proposals since their last visit: shown once, then they drop off.
    prisma.changeProposal.findMany({
      where: { proposedById: userId, status: { in: ["APPLIED", "REJECTED", "FAILED"] }, reviewedAt: { gt: since ?? week } },
      select: { status: true, reviewedAt: true, reviewer: { select: { name: true } } },
      orderBy: { reviewedAt: "desc" },
      take: 500,
    }),
  ]);

  const watchedIds = watches.map((row) => row.locationId);
  const othersChanges = watchedIds.length
    ? await prisma.fieldChange.findMany({
        where: { locationId: { in: watchedIds }, userId: { not: userId }, createdAt: { gte: new Date(now - 14 * DAY) } },
        include: changeInclude,
        orderBy: { createdAt: "desc" },
        take: 300,
      })
    : [];

  const watched = await withLabels(groupByRecord(othersChanges.map(toRow), canSee, { since, limit: 8, perRecord: 3 }));
  const mine = await withLabels(groupByRecord(myRecent.map(toRow), canSee, { since: null, limit: 8, perRecord: 0 }));
  const recentDates = myDates.filter((row) => row.createdAt >= week);
  const overdue = input.openTasks.filter((task) => task.deadlineAt.getTime() < now).length;
  const dueSoon = input.openTasks.filter((task) => task.deadlineAt.getTime() >= now && task.deadlineAt.getTime() < now + 2 * DAY).length;

  return {
    stats: {
      edits: recentDates.length,
      records: new Set(recentDates.map((row) => row.locationId)).size,
      completed,
      overdue,
    },
    sparkline: dailyCounts(myDates.map((row) => row.createdAt), now, 30),
    attention: {
      overdue,
      dueSoon,
      pendingProposals,
      reviewedProposals: summarizeReviews(reviewed.map((row) => ({ status: row.status, reviewer: row.reviewer?.name ?? "", reviewedAt: row.reviewedAt! }))),
      watchedChanged: watched.filter((group) => group.isNew).length,
    },
    watched,
    watchingCount: watchedIds.length,
    mine,
  };
}

/** Groups reviews by outcome and reviewer, newest group first, so a batch shows as one line. */
export function summarizeReviews(rows: { status: string; reviewer: string; reviewedAt: Date }[]) {
  const groups = new Map<string, { status: string; reviewer: string; count: number; latest: Date }>();
  for (const row of rows) {
    const key = `${row.status}\u0000${row.reviewer}`;
    const group = groups.get(key) ?? { status: row.status, reviewer: row.reviewer, count: 0, latest: row.reviewedAt };
    group.count += 1;
    if (row.reviewedAt > group.latest) group.latest = row.reviewedAt;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.latest.getTime() - a.latest.getTime());
}
