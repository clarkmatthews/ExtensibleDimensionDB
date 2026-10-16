import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { OwnSettings, type OwnDimension, type OwnScreen } from "@/components/own-settings";
import { ScopeAssignments } from "@/components/scope-assignments";
import { saveUser, saveUserWorkflowSteps, setUserActive, signOutEverywhere } from "@/lib/access-actions";
import { NAV_MODULES } from "@/lib/nav-modules";
import { RIGHTS, type Level } from "@/lib/permission-labels";
import { PASSWORD_RULES } from "@/lib/passwords";
import {
  canEditModule,
  canViewModule,
  categoryAccess,
  categoryAccessIn,
  fieldAccessIn,
  groupTiersFor,
  loadAccess,
  moduleAccessIn,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  const access = await loadAccess(actor);
  if (!canViewModule(access, "USERS")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "USERS");
  const canSeeGroups = canViewModule(access, "ACCESS");
  const canEditGroups = canEditModule(access, "ACCESS");
  const { id } = await params;
  const query = await searchParams;
  const [account, groups, categories, processes, scopes, scopeGrants] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { groups: true } }),
    prisma.group.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        fields: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.workflowProcess.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      // Notify steps notify a person directly; only action steps are assigned here.
      include: { steps: { where: { kind: "ACTION" }, orderBy: { sortOrder: "asc" }, include: { group: true, assigneeUser: true } } },
    }),
    prisma.scope.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
    prisma.scopeAssignment.findMany({ select: { scopeId: true, subjectType: true, subjectId: true } }),
  ]);
  if (!account) notFound();
  const subject = await loadAccess(account);
  const groupTiers = groupTiersFor(subject);
  const own = (row: { subjectType: string; subjectId: string }) => row.subjectType === "USER" && row.subjectId === account.id;
  const ownScreens: OwnScreen[] = NAV_MODULES.map((item) => ({
    id: item.id,
    label: item.label,
    section: item.group,
    inherited: moduleAccessIn(groupTiers, subject.modulePerms, item.id),
    own: subject.modulePerms.find((row) => own(row) && row.module === item.id)?.grantLevel ?? null,
  }));
  const ownDimensions: OwnDimension[] = categories.map((category) => {
    const fromGroups = categoryAccessIn(groupTiers, subject.categoryPerms, category.id);
    const fields = category.fields.map((field) => {
      const rights = fieldAccessIn(groupTiers, subject.categoryPerms, subject.fieldPerms, field.id, category.id);
      const inherited: Level = !fromGroups.canViewData || !rights.canView ? "NONE" : rights.canUpdate ? "EDIT" : "VIEW";
      const row = subject.fieldPerms.find((item) => own(item) && item.fieldId === field.id);
      const ownLevel: Level | null = row ? (row.canUpdate ? "EDIT" : row.canView ? "VIEW" : "NONE") : null;
      return { id: field.id, friendlyName: field.friendlyName, inherited, own: ownLevel };
    });
    const levels = new Set(fields.map((field) => field.inherited));
    const row = subject.categoryPerms.find((item) => own(item) && item.categoryId === category.id);
    return {
      id: category.id,
      name: category.name,
      editable: actor.isAdmin || categoryAccess(access, category.id).canAssignPermissions,
      inheritedData: levels.size > 1 ? "MIXED" : (fields[0]?.inherited ?? (fromGroups.canViewData ? "VIEW" : "NONE")),
      ownData: row?.applyToFields ? "FIELDS" : (row?.grantLevel ?? null),
      inheritedRights: Object.fromEntries(RIGHTS.map((item) => [item.key, fromGroups[item.right]])) as OwnDimension["inheritedRights"],
      ownRights: Object.fromEntries(RIGHTS.map((item) => [item.key, row?.[item.right] ?? null])) as OwnDimension["ownRights"],
      fields,
    };
  });
  const memberGroups = new Set(account.groups.map((membership) => membership.groupId));
  const activeSessions = await prisma.session.findMany({
    where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, lastSeenAt: true, userAgent: true },
  });
  const saved =
    query.saved === "sessions" ? "Signed out everywhere." :
    query.saved === "account" ? "Account saved." : query.saved === "permissions" ? "Permissions saved." : query.saved === "scopes" ? "Scopes saved." : query.saved === "workflows" ? "Workflow assignment saved." : "";

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm font-semibold text-pine" href="/admin/users">Users</Link>
        <h1 className="mt-1 flex items-center text-2xl font-semibold">
          {account.name}
          <HelpTip text="Change this person's name, email, password, groups, scopes, own settings, and workflow assignments. An empty new password keeps the current one." />
        </h1>
        <p className="text-sm text-muted">{account.email}</p>
        {account.mustChangePassword && !account.isAdmin ? (
          <p className="mt-1 text-sm text-muted">Will choose their own password at their next sign-in.</p>
        ) : null}
      </div>
      {query.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{query.error}</p> : null}
      {saved ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">{saved}</p> : null}

      <fieldset disabled={!canEdit} className="min-w-0 space-y-6 border-0 p-0">
      <form action={saveUser} className="panel space-y-4 p-4">
        <h2 className="font-semibold">Account</h2>
        <input type="hidden" name="id" value={account.id} />
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <span className="label">Name</span>
            <input className="field" name="name" defaultValue={account.name} required maxLength={100} />
          </label>
          <label>
            <span className="label">Email</span>
            <input className="field" name="email" type="email" defaultValue={account.email} required maxLength={254} />
          </label>
          <label>
            <span className="label">New password <HelpTip text="Leave this blank to keep the current password. If you set a new password for someone who is not an administrator, they choose their own at their next sign-in. A new password must be 12 to 128 characters and include upper and lower case, a number, and a symbol, and it must not include the person's name or email." /></span>
            <input className="field" name="password" type="password" autoComplete="new-password" placeholder="Leave blank to keep the current password" />
          </label>
          <label>
            <span className="label">Confirm new password</span>
            <input className="field" name="confirmPassword" type="password" autoComplete="new-password" />
          </label>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {PASSWORD_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        {actor.isAdmin ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input name="isAdmin" type="checkbox" defaultChecked={account.isAdmin} /> Administrator <HelpTip text="An administrator can open and change every part of the product. Navigation and dimension grants do not limit them." /></label>
          <label className="flex items-center gap-2"><input name="canDefineWorkflows" type="checkbox" defaultChecked={account.canDefineWorkflows} /> Can define structure and workflows <HelpTip text="Kept for earlier accounts. Page access now comes from groups." /></label>
        </div>
        ) : (
          <p className="text-sm text-muted">{account.isAdmin ? "Administrator." : "Not an administrator."} Screens and dimension access come from their groups, with any exceptions under Own settings.</p>
        )}
        <div>
          <p className="label">Groups <HelpTip text="This person gets the permissions of every group they belong to, and can receive those groups' workflow actions." /></p>
          {groups.length ? (
            <div className="flex flex-wrap gap-3 text-sm">
              {groups.map((group) => (
                <label key={group.id} className="flex items-center gap-2">
                  <input name="groupId" type="checkbox" value={group.id} defaultChecked={memberGroups.has(group.id)} />
                  {group.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No active groups yet. Create one on Groups.</p>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn" type="submit">Save account</button>
          {account.id !== actor.id ? (
            <>
              <input type="hidden" name="active" value={account.isActive ? "0" : "1"} />
              <span className="inline-flex items-center">
                <button className="btn-quiet" formAction={setUserActive} type="submit">
                  {account.isActive ? "Disable" : "Enable"}
                </button>
                <HelpTip text="A disabled person cannot sign in. Their grants and history stay." />
              </span>
            </>
          ) : null}
        </div>
      </form>

      <section className="panel space-y-3 p-4">
        <h2 className="flex items-center text-lg font-semibold">
          Signed-in sessions
          <HelpTip text="Each browser where this person is signed in. Changing the password or disabling the account signs them out everywhere. Sign out everywhere does the same without changing anything else." />
        </h2>
        {activeSessions.length === 0 ? <p className="text-sm text-muted">Not signed in anywhere.</p> : (
          <ul className="space-y-1 text-sm">
            {activeSessions.map((session) => (
              <li key={session.id}>
                <span className="text-muted">Last active {session.lastSeenAt.toLocaleString()}</span>
                {session.userAgent ? <span className="block truncate text-xs text-muted" title={session.userAgent}>{describeAgent(session.userAgent)}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit && activeSessions.length ? (
          <form action={signOutEverywhere}>
            <input type="hidden" name="id" value={account.id} />
            <button className="btn-quiet" type="submit">
              {account.id === actor.id ? "Sign out my other sessions" : "Sign out everywhere"}
            </button>
          </form>
        ) : null}
      </section>

      </fieldset>

      {canSeeGroups ? <OwnSettings userId={account.id} isAdmin={account.isAdmin} canEdit={canEditGroups} screens={ownScreens} dimensions={ownDimensions} /> : null}
      {canSeeGroups ? (
        <div className="panel p-4">
          <ScopeAssignments
            subjectType="USER"
            subjectId={account.id}
            returnTo={`/admin/users/${account.id}`}
            scopes={scopes}
            assignedIds={scopeGrants.filter((row) => row.subjectType === "USER" && row.subjectId === account.id).map((row) => row.scopeId)}
            inherited={scopes.filter((scope) => scopeGrants.some((row) => row.subjectType === "GROUP" && row.scopeId === scope.id && memberGroups.has(row.subjectId))).map((scope) => scope.name)}
            canEdit={canEditGroups}
            divider={false}
          />
        </div>
      ) : null}

      <fieldset disabled={!canEdit} className="min-w-0 space-y-6 border-0 p-0">
      <form action={saveUserWorkflowSteps} className="panel space-y-3 p-4">
        <h2 className="flex items-center font-semibold">
          Workflows
          <HelpTip text="Checking a step assigns new actions for that step to this user. The user must belong to the step's group. The same assignment can be changed on the workflow." />
        </h2>
        <p className="text-sm text-muted">
          Checking a step assigns new actions for that step to this user. The user must belong to the step&apos;s group. The same assignment can be changed on the workflow.
        </p>
        <input type="hidden" name="userId" value={account.id} />
        {processes.flatMap((process) => process.steps).length === 0 ? (
          <p className="text-sm text-muted">No workflow steps yet.</p>
        ) : (
          processes.map((process) => (
            <div key={process.id}>
              <p className="text-sm font-semibold">{process.name}</p>
              <div className="mt-2 space-y-2">
                {process.steps.map((step) => {
                  const inGroup = step.groupId ? memberGroups.has(step.groupId) : false;
                  const takenBy = step.assigneeUser && step.assigneeUser.id !== account.id ? step.assigneeUser.name : "";
                  return (
                    <label key={step.id} className="flex items-start gap-2 text-sm">
                      <input name="stepId" type="checkbox" value={step.id} defaultChecked={step.assigneeUserId === account.id} disabled={!inGroup} />
                      <span>
                        {step.name}
                        <span className="text-muted"> · {step.group?.name ?? "No group"}</span>
                        {takenBy ? <span className="text-muted"> · currently {takenBy}</span> : null}
                        {!inGroup ? <span className="text-muted"> · add this user to the group first</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <button className="btn" type="submit">Save workflow assignment</button>
      </form>
      </fieldset>
    </div>
  );
}

/** A short description of a browser, such as "Chrome on macOS", from its user agent. */
function describeAgent(agent: string) {
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const system = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}
