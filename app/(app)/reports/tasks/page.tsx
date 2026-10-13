import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { taskAction } from "@/lib/store-actions";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Action report" };

export default async function TaskReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    groupId?: string;
    userId?: string;
    from?: string;
    to?: string;
    stores?: string;
    includeAll?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "TASK_REPORT")) return <ModuleDenied />;
  const params = await searchParams;
  const [groups, users] = await Promise.all([
    prisma.group.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const from = params.from ? new Date(params.from) : null;
  const to = params.to ? new Date(`${params.to}T23:59:59`) : null;
  const includeAll = params.includeAll === "1";
  const tasks = await prisma.task.findMany({
    where: {
      ...(from || to
        ? {
            createdAt: { lte: to ?? undefined },
            OR: [{ completedAt: null }, { completedAt: { gte: from ?? undefined } }],
          }
        : {}),
    },
    include: {
      step: true,
      assigneeGroup: true,
      assigneeUser: true,
      events: { include: { user: true }, orderBy: { createdAt: "asc" } },
      storeProcess: { include: { process: true, originator: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const storeTokens = (params.stores ?? "").split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);
  const filtered = [];
  for (const task of tasks) {
    if (params.userId) {
      const involved = task.assigneeUserId === params.userId || task.events.some((event) => event.userId === params.userId) || task.storeProcess.originatorId === params.userId;
      const assignedToUser = task.assigneeUserId === params.userId;
      if (includeAll ? !involved : !assignedToUser) continue;
    } else if (params.groupId) {
      if (task.assigneeGroupId !== params.groupId) continue;
    }
    if (storeTokens.length) {
      const code = await prisma.fieldValue.findFirst({
        where: { locationId: task.locationId, field: { isStoreKey: true } },
      });
      const text = (code?.valueText ?? task.locationId).toLowerCase();
      if (!storeTokens.some((token) => text.includes(token))) continue;
    }
    filtered.push(task);
  }

  return (
    <div className="space-y-4">
      <h1 className="flex items-center text-2xl font-semibold">
        Action report
        <HelpTip text="Review actions and what was done on them. Group and user narrow the list. Dates limit actions that were open in that range. Dimension codes match the unique identifier attribute." />
      </h1>
      <form className="panel grid gap-3 p-4 md:grid-cols-3" action="/reports/tasks">
        <select className="field" name="groupId" defaultValue={params.groupId ?? ""}>
          <option value="">Any group</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <select className="field" name="userId" defaultValue={params.userId ?? ""}>
          <option value="">Any user</option>
          {users.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        <label>
          <span className="label">From <HelpTip text="Include actions that were still open on or after this date." /></span>
          <input className="field" type="date" name="from" defaultValue={params.from ?? ""} />
        </label>
        <label>
          <span className="label">To <HelpTip text="Include actions that were created on or before this date." /></span>
          <input className="field" type="date" name="to" defaultValue={params.to ?? ""} />
        </label>
        <label>
          <span className="label">Dimensions <HelpTip text="Comma-separated identifiers. An action is included when its unique dimension identifier contains one of these values." /></span>
          <input className="field" name="stores" defaultValue={params.stores ?? ""} placeholder="Dimension codes, comma separated" />
        </label>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input name="includeAll" type="checkbox" value="1" defaultChecked={includeAll} />
          Include every action they touched, not only actions on that dashboard
          <HelpTip text="With a user selected, this includes actions they worked on or started, not only actions currently assigned to them." />
        </label>
        <button className="btn" type="submit">Run report</button>
      </form>
      <div className="space-y-3">
        {filtered.map((task) => (
          <article key={task.id} className="panel p-4 text-sm">
            <p className="font-semibold">{task.storeProcess.process.name} · {task.step.name}</p>
            <p className="text-muted">
              {task.state} · {task.assigneeGroup.name}
              {task.assigneeUser ? ` · ${task.assigneeUser.name}` : ""} · {task.createdAt.toLocaleString()}
            </p>
            {!task.completedAt ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={taskAction} className="flex items-center gap-2">
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="action" value="POSTPONE" />
                  <input type="hidden" name="returnTo" value="/reports/tasks" />
                  <input className="field w-24" name="postponeDays" placeholder="Days" />
                  <input className="field w-40" name="comment" placeholder="Comment" required />
                  <button className="btn-quiet" type="submit">Postpone</button>
                </form>
                <form action={taskAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="action" value="SUSPEND" />
                  <input type="hidden" name="returnTo" value="/reports/tasks" />
                  <button className="btn-quiet" type="submit">Suspend</button>
                </form>
              </div>
            ) : null}
            <ul className="mt-2 space-y-1">
              {task.events.map((event) => (
                <li key={event.id}>
                  {event.createdAt.toLocaleString()} · {event.user.name} · {event.action.toLowerCase()}
                  {event.comment ? ` · ${event.comment}` : ""}
                </li>
              ))}
            </ul>
          </article>
        ))}
        {filtered.length === 0 ? <p className="text-sm text-muted">No actions match.</p> : null}
      </div>
    </div>
  );
}
