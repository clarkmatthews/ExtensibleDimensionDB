import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { canEditModule, canViewModule, firstModuleHref, loadAccess } from "@/lib/permissions";
import { taskAction } from "@/lib/store-actions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { raiseOverdueAlerts } from "@/lib/workflow";

const PRIORITY_RANK = { HIGH: 0, NORMAL: 1, LOW: 2 };

export const metadata: Metadata = { title: "Dashboard" };

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
  await raiseOverdueAlerts();
  const recent = await prisma.notification.findMany({
    where: { userId: user.id, fieldChangeId: { not: null } },
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
  const now = Date.now();
  const ordered = [...tasks].sort((left, right) => {
    const leftOverdue = left.deadlineAt.getTime() < now && left.state === "UNACCEPTED";
    const rightOverdue = right.deadlineAt.getTime() < now && right.state === "UNACCEPTED";
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    if (left.state !== right.state) return left.state === "UNACCEPTED" ? -1 : 1;
    const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    if (priority !== 0) return priority;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
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
            <HelpTip text="Open actions assigned to you or to a group you belong to. When a change opened the action, the previous and new values are shown. Recent changes are notifications sent to you." />
          </h1>
          <p className="text-sm text-muted">Open actions first. Recent changes follow.</p>
        </div>
        <Link className="btn-quiet" href="/dashboard">Refresh</Link>
      </div>
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
                {task.fieldChange.field.friendlyName}: {task.fieldChange.oldValue || "blank"} → {task.fieldChange.newValue || "blank"}
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
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Recent changes</h2>
        {recent.length === 0 ? <p className="text-sm text-muted">No change notifications.</p> : null}
        {recent.map((notice) => notice.fieldChange ? (
          <article key={notice.id} className="panel px-4 py-3 text-sm">
            <p>
              <Link className="font-semibold text-pine" href={`/dimensions/${notice.fieldChange.locationId}`}>{notice.fieldChange.field.friendlyName}</Link>
              {": "}{notice.fieldChange.oldValue || "blank"} → {notice.fieldChange.newValue || "blank"}
            </p>
            <p className="text-xs text-muted">{notice.fieldChange.user.name} · {notice.fieldChange.createdAt.toLocaleString()}</p>
          </article>
        ) : null)}
      </section>
    </div>
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
