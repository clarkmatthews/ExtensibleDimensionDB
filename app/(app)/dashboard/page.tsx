import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { loadDashboardActivity, timeAgo, type RecordActivity } from "@/lib/activity";
import { canEditModule, canSeeValue, canViewModule, firstModuleHref, loadAccess } from "@/lib/permissions";
import { taskAction } from "@/lib/store-actions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

const PRIORITY_RANK = { HIGH: 0, NORMAL: 1, LOW: 2 };

export const metadata: Metadata = { title: "Dashboard" };

/** The time this request is rendered, read once so sorting and the overdue labels agree. */
function requestTime() {
  return Date.now();
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "INBOX")) {
    const next = firstModuleHref(access);
    if (next) redirect(next);
    return <ModuleDenied />;
  }
  const canEdit = canEditModule(access, "INBOX");
  const params = await searchParams;
  const recent = await prisma.notification.findMany({
    // Change notices, and notices about a record (a notify step, a record created).
    where: { userId: user.id, OR: [{ fieldChangeId: { not: null } }, { locationId: { not: null } }] },
    include: { fieldChange: { include: { field: true, user: true } } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  const groupIds = user.groups.map((membership) => membership.groupId);
  const tasks = await prisma.task.findMany({
    where: {
      completedAt: null,
      state: { in: ["UNACCEPTED", "ACCEPTED"] },
      storeProcess: { suspended: false, status: "ACTIVE" },
      OR: [
        { assigneeUserId: user.id },
        { assigneeUserId: null, assigneeGroupId: { in: groupIds } },
        ...(user.isAdmin ? [{ assigneeUserId: null }] : []),
      ],
    },
    include: {
      step: true,
      assigneeGroup: { include: { members: { include: { user: true } } } },
      storeProcess: { include: { process: true } },
      fieldChange: { include: { field: true, user: true } },
    },
  });
  const now = requestTime();
  const ordered = [...tasks].sort((left, right) => {
    const leftOverdue = left.deadlineAt.getTime() < now && left.state === "UNACCEPTED";
    const rightOverdue = right.deadlineAt.getTime() < now && right.state === "UNACCEPTED";
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    if (left.state !== right.state) return left.state === "UNACCEPTED" ? -1 : 1;
    const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    if (priority !== 0) return priority;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
  // What is new is judged against the previous visit; this visit becomes the next baseline.
  const since = user.dashboardSeenAt;
  const activity = await loadDashboardActivity({ access, since, now, openTasks: tasks });
  await prisma.user.update({ where: { id: user.id }, data: { dashboardSeenAt: new Date(now) } });
  const { stats, attention } = activity;
  const attentionItems = [
    attention.overdue ? { href: "#actions", text: `${attention.overdue} overdue ${attention.overdue === 1 ? "action" : "actions"}`, urgent: true } : null,
    attention.dueSoon ? { href: "#actions", text: `${attention.dueSoon} ${attention.dueSoon === 1 ? "action" : "actions"} due in the next 2 days`, urgent: false } : null,
    attention.pendingProposals
      ? { href: "/proposals", text: `${attention.pendingProposals} AI ${attention.pendingProposals === 1 ? "proposal" : "proposals"} waiting for review`, urgent: false }
      : null,
    attention.watchedChanged
      ? { href: "#watched", text: `${attention.watchedChanged} watched ${attention.watchedChanged === 1 ? "record" : "records"} changed since your last visit`, urgent: false }
      : null,
    ...attention.reviewedProposals.map((proposal) => ({
      href: "/proposals",
      text: `Your proposal${proposal.reason ? ` "${proposal.reason.slice(0, 60)}"` : ""} was ${proposal.status === "REJECTED" ? "rejected" : proposal.status === "FAILED" ? "approved but could not be applied" : "approved and applied"}${proposal.reviewer ? ` by ${proposal.reviewer}` : ""} · ${timeAgo(proposal.reviewedAt, now)}`,
      urgent: proposal.status !== "APPLIED",
    })),
  ].filter((item) => item !== null);
  const seenStores = new Set<string>();
  const visible = ordered.filter((task) => {
    if (seenStores.has(task.locationId)) return false;
    seenStores.add(task.locationId);
    return true;
  });

  return (
    <div className="space-y-4">
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center text-2xl font-semibold">
            Dashboard
            <HelpTip text="Your week at a glance, what needs your attention, your open actions, other people's edits to records you watch, and your own recent edits. Values you cannot view are never shown." />
          </h1>
          <p className="text-sm text-muted">{since ? `Last visit ${timeAgo(since, now)}.` : "Welcome."}</p>
        </div>
        <Link className="btn-quiet" href="/dashboard">Refresh</Link>
      </div>

      <section aria-label="Your last 7 days" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Edits" value={stats.edits} note="last 7 days" />
        <Stat label="Records touched" value={stats.records} note="last 7 days" />
        <Stat label="Actions completed" value={stats.completed} note="last 7 days" />
        <Stat label="Overdue actions" value={stats.overdue} note={stats.overdue ? "need you now" : "none"} warn={stats.overdue > 0} />
        <Sparkline counts={activity.sparkline} />
      </section>

      {attentionItems.length ? (
        <section className="panel border-l-4 border-l-pine p-4">
          <h2 className="font-semibold">Needs your attention</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {attentionItems.map((item) => (
              <li key={item.text} className="flex items-start gap-2">
                <span aria-hidden="true" className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${item.urgent ? "bg-danger" : "bg-pine"}`} />
                <Link className="text-pine hover:underline" href={item.href}>{item.text}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 id="actions" className="text-lg font-semibold">Open actions</h2>
      {visible.length === 0 ? <p className="text-sm text-muted">No open actions.</p> : null}
      {visible.map((task) => {
        const overdue = task.deadlineAt.getTime() < now;
        return (
          <article key={task.id} className="panel p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{task.storeProcess.process.name}: {task.step.name}</h2>
              <p className="text-sm text-muted">
                {task.state === "UNACCEPTED" ? "Unaccepted" : "Accepted"}
                {overdue ? " · overdue" : ""} · due {task.deadlineAt.toLocaleDateString()}
              </p>
            </div>
            <p className="mt-1 text-sm text-muted">Assigned to {task.assigneeGroup.name}</p>
            {task.fieldChange ? (
              <p className="mt-2 text-sm">
                {canSeeValue(access, task.fieldChange.fieldId, task.fieldChange.field.categoryId)
                  ? <>{task.fieldChange.field.friendlyName}: {task.fieldChange.oldValue || "blank"} → {task.fieldChange.newValue || "blank"}</>
                  : "A change to an attribute you cannot view opened this action."}
                <span className="text-muted"> · {task.fieldChange.user.name} · {task.fieldChange.createdAt.toLocaleString()}</span>
              </p>
            ) : null}
            {canEdit ? <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center">
                <Link className="btn" href={`/dimensions/${task.locationId}?task=${task.id}`}>Perform</Link>
                <HelpTip text="Open the record and edit the attributes this step requires. Highlighted attributes are the ones attached to this step." />
              </span>
              {task.state === "UNACCEPTED" ? (
                <form action={taskAction} className="inline-flex items-center">
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="action" value="ACCEPT" />
                  <button className="btn-quiet" type="submit">Accept</button>
                  <HelpTip text="Take this action. It stays on your dashboard and is marked accepted." />
                </form>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ActionForm taskId={task.id} action="DONE" label="Done" comment={false} extra="nextDeadlineDays" extraLabel="Next deadline days" help="Completes this step and opens the next one. Attributes that must have a value need one. Attributes that must change need an edit saved after this action opened. Next deadline days replaces the next step's usual deadline." />
              <ActionForm taskId={task.id} action="REJECT" label="Reject" help="Sends the action back to the previous step and records the comment. The first step cannot be rejected." />
              <ActionForm taskId={task.id} action="COMMENT" label="Comment" help="Adds a note to the action without changing its state." />
              <form action={taskAction} className="space-y-2 rounded-md border border-line p-3">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="action" value="ASSIGN" />
                <label className="block text-sm">
                  <span className="label">Assign in group <HelpTip text="Give this action to one member of the assigned group. That person is notified." /></span>
                  <select className="field" name="assigneeUserId">
                    {task.assigneeGroup.members.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.user.name}</option>
                    ))}
                  </select>
                </label>
                <button className="btn-quiet" type="submit">Assign</button>
              </form>
            </div>
            </> : (
              <p className="mt-3 text-sm text-muted">You can view this action. Edit access is required to act on it.</p>
            )}
          </article>
        );
      })}
      {canViewModule(access, "STORES") ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section id="watched" className="space-y-2">
            <h2 className="flex items-center text-lg font-semibold">
              Changes to records you watch
              <HelpTip text="Edits other people made in the last 14 days to records you watch. You watch a record when you create or edit it, or with Watch on the record. New marks edits since your last visit." />
            </h2>
            {activity.watched.length === 0 ? (
              <p className="text-sm text-muted">
                {activity.watchingCount
                  ? `Nobody else has edited the ${activity.watchingCount === 1 ? "record" : `${activity.watchingCount} records`} you watch in the last 14 days.`
                  : "You are not watching any records yet. Open a record and choose Watch, or edit one."}
              </p>
            ) : null}
            {activity.watched.map((record) => <RecordCard key={record.locationId} record={record} now={now} showEdits />)}
          </section>
          <section className="space-y-2">
            <h2 className="flex items-center text-lg font-semibold">
              Your recent edits
              <HelpTip text="Records you edited in the last 14 days, most recent first, with the attributes you changed." />
            </h2>
            {activity.mine.length === 0 ? <p className="text-sm text-muted">You have not edited any records in the last 14 days.</p> : null}
            {activity.mine.map((record) => <RecordCard key={record.locationId} record={record} now={now} showEdits={false} />)}
          </section>
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Notices</h2>
        {recent.length === 0 ? <p className="text-sm text-muted">No changes or notices.</p> : null}
        {recent.map((notice) => notice.fieldChange ? (
          <article key={notice.id} className="panel px-4 py-3 text-sm">
            {canSeeValue(access, notice.fieldChange.fieldId, notice.fieldChange.field.categoryId) ? (
              <p>
                <Link className="font-semibold text-pine" href={`/dimensions/${notice.fieldChange.locationId}`}>{notice.fieldChange.field.friendlyName}</Link>
                {": "}{notice.fieldChange.oldValue || "blank"} → {notice.fieldChange.newValue || "blank"}
              </p>
            ) : (
              <p>
                <Link className="font-semibold text-pine" href={`/dimensions/${notice.fieldChange.locationId}`}>A record changed</Link>
                {". You do not have access to the changed attribute."}
              </p>
            )}
            <p className="text-xs text-muted">{notice.fieldChange.user.name} · {notice.fieldChange.createdAt.toLocaleString()}</p>
          </article>
        ) : notice.locationId ? (
          <article key={notice.id} className="panel px-4 py-3 text-sm">
            <p>
              {notice.message}{" "}
              <Link className="font-semibold text-pine" href={`/dimensions/${notice.locationId}`}>Open record</Link>
            </p>
            <p className="text-xs text-muted">{notice.createdAt.toLocaleString()}</p>
          </article>
        ) : null)}
      </section>
    </div>
  );
}

function Stat({ label, value, note, warn = false }: { label: string; value: number; note: string; warn?: boolean }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${warn ? "text-danger" : ""}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

/** Your edits per day for the last 30 days. */
function Sparkline({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const width = 150;
  const height = 36;
  const step = width / counts.length;
  return (
    <div className="panel px-4 py-3">
      <p className="text-sm text-muted">Your edits, 30 days</p>
      <svg className="mt-1 block text-pine" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${total} edits in the last 30 days`}>
        <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} stroke="currentColor" strokeOpacity="0.2" />
        {counts.map((count, index) => {
          const barHeight = count ? Math.max(2, (count / max) * (height - 2)) : 0;
          return (
            <rect key={index} x={index * step + 0.5} y={height - barHeight} width={Math.max(1, step - 1.5)} height={barHeight} rx="1" fill="currentColor">
              <title>{`${count} ${count === 1 ? "edit" : "edits"}, ${counts.length - 1 - index === 0 ? "today" : `${counts.length - 1 - index} days ago`}`}</title>
            </rect>
          );
        })}
      </svg>
      <p className="text-xs text-muted">{total.toLocaleString()} total</p>
    </div>
  );
}

function RecordCard({ record, now, showEdits }: { record: RecordActivity; now: number; showEdits: boolean }) {
  return (
    <article className="panel px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <Link className="font-semibold text-pine hover:underline" href={`/dimensions/${record.locationId}`}>{record.label}</Link>
          {record.typeName ? <span className="text-muted"> · {record.typeName}</span> : null}
          {record.isNew ? <span className="ml-2 rounded bg-emerald-50 px-1.5 text-xs font-semibold text-pine">New</span> : null}
        </p>
        <p className="text-xs text-muted">{timeAgo(record.latestAt, now)}</p>
      </div>
      {showEdits ? (
        <>
          <ul className="mt-1 space-y-0.5">
            {record.shown.map((edit, index) => (
              <li key={index}>
                {edit.attribute}: <span className="text-muted">{edit.oldValue || "blank"}</span> → {edit.newValue || "blank"}
                <span className="text-xs text-muted"> · {edit.userName}</span>
              </li>
            ))}
          </ul>
          {record.total > record.shown.length ? (
            <p className="mt-1 text-xs text-muted">
              {record.total - record.shown.length} more {record.total - record.shown.length === 1 ? "edit" : "edits"}
              {record.hidden ? `, ${record.hidden} to attributes you cannot view` : ""} · by {record.people.join(", ")}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-muted">
          {record.attributes.length ? record.attributes.join(", ") : "Attributes you can no longer view"}
          {` · ${record.total} ${record.total === 1 ? "edit" : "edits"}`}
        </p>
      )}
    </article>
  );
}

function ActionForm({
  taskId,
  action,
  label,
  comment = true,
  extra,
  extraLabel,
  help,
}: {
  taskId: string;
  action: string;
  label: string;
  comment?: boolean;
  extra?: string;
  extraLabel?: string;
  help: string;
}) {
  return (
    <form action={taskAction} className="space-y-2 rounded-md border border-line p-3">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="action" value={action} />
      {comment ? <input className="field" name="comment" placeholder="Comment" required={action === "REJECT"} /> : null}
      {extra ? <input className="field" name={extra} placeholder={extraLabel} /> : null}
      <span className="inline-flex items-center">
        <button className="btn-quiet" type="submit">{label}</button>
        <HelpTip text={help} />
      </span>
    </form>
  );
}
