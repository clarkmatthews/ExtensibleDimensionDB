import Link from "next/link";
import { redirect } from "next/navigation";
import { GroupPermissionsForm, type GroupDimension } from "@/components/group-permissions-form";
import { ScopeAssignments } from "@/components/scope-assignments";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { saveGroup, setGroupActive } from "@/lib/access-actions";
import { NAV_MODULES } from "@/lib/nav-modules";
import { RIGHTS, type Level, type RightKey } from "@/lib/permission-labels";
import { canEditModule, canViewModule, categoryAccess, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

const asLevel = (value: string | null | undefined): Level => (value === "VIEW" || value === "EDIT" ? value : "NONE");

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; open?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const actorAccess = await loadAccess(user);
  if (!canViewModule(actorAccess, "ACCESS")) return <ModuleDenied />;
  const canEdit = canEditModule(actorAccess, "ACCESS");
  const params = await searchParams;
  const [groups, categories, categoryGrants, fieldGrants, screenGrants, scopes, scopeGrants] = await Promise.all([
    prisma.group.findMany({
      orderBy: { name: "asc" },
      include: { members: { include: { user: { select: { id: true, name: true, isActive: true } } } } },
    }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.categoryPermission.findMany({ where: { subjectType: "GROUP" } }),
    prisma.fieldPermission.findMany({ where: { subjectType: "GROUP" } }),
    prisma.modulePermission.findMany({ where: { subjectType: "GROUP" } }),
    prisma.scope.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
    prisma.scopeAssignment.findMany({ where: { subjectType: "GROUP" }, select: { scopeId: true, subjectId: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Groups
          <HelpTip text="Permissions are assigned to groups. Each group sets which screens its members can open and what they can see and change in each dimension. A scope on a group limits which records those members can see. A person in several groups gets the combined access. A person's page can override single items for that person." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Permissions are assigned here. Each group sets its members&apos; screens and their access to each dimension; a person in several groups gets the combined access. Scopes, which limit rows, are created on{" "}
          <Link className="font-semibold text-pine" href="/admin/scopes">Scopes</Link> and assigned on a group below. To make an exception for one person, set it under Own settings on their page in{" "}
          <Link className="font-semibold text-pine" href="/admin/users">Users</Link>, which is also where people join groups.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {params.saved === "group" ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Group permissions saved.</p> : null}
      {params.saved === "scopes" ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Scopes saved.</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view groups. Edit access to Groups is required to change them.</p> : null}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-3 border-0 p-0">
        <form action={saveGroup} className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
          <input className="field" name="name" placeholder="New group name" required />
          <input className="field" name="description" placeholder="Description" />
          <button className="btn" type="submit">Add group</button>
        </form>
        {groups.map((group) => {
          const screens = NAV_MODULES.map((item) => ({
            id: item.id,
            label: item.label,
            section: item.group,
            level: asLevel(screenGrants.find((row) => row.subjectId === group.id && row.module === item.id)?.grantLevel),
          }));
          const dimensions: GroupDimension[] = categories.map((category) => {
            const grant = categoryGrants.find((row) => row.subjectId === group.id && row.categoryId === category.id);
            const level = grant && !grant.applyToFields ? asLevel(grant.grantLevel) : "NONE";
            return {
              id: category.id,
              name: category.name,
              editable: user.isAdmin || categoryAccess(actorAccess, category.id).canAssignPermissions,
              level,
              applyToFields: grant?.applyToFields ?? false,
              rights: Object.fromEntries(RIGHTS.map((item) => [item.key, Boolean(grant?.[item.right])])) as Record<RightKey, boolean>,
              fields: category.fields.map((field) => {
                const fieldGrant = fieldGrants.find((row) => row.subjectId === group.id && row.fieldId === field.id);
                const fieldLevel: Level = fieldGrant?.canUpdate ? "EDIT" : fieldGrant?.canView ? "VIEW" : !grant?.applyToFields ? level : "NONE";
                return { id: field.id, friendlyName: field.friendlyName, isActive: field.isActive, level: fieldLevel };
              }),
            };
          });
          const screenCount = screens.filter((screen) => screen.level !== "NONE").length;
          const dimensionCount = dimensions.filter(
            (item) => item.level !== "NONE" || item.fields.some((field) => item.applyToFields && field.level !== "NONE") || Object.values(item.rights).some(Boolean),
          ).length;
          const members = group.members.map((row) => row.user).sort((a, b) => a.name.localeCompare(b.name));
          return (
            <details key={group.id} id={`group-${group.id}`} open={params.open === group.id} className="panel p-3">
              <summary className="cursor-pointer">
                <span className="font-semibold">{group.name}</span>
                {group.isActive ? null : <span className="ml-2 text-sm text-muted">(disabled)</span>}
                <span className="ml-2 text-sm text-muted">
                  {members.length === 1 ? "1 member" : `${members.length} members`} · {screenCount === 1 ? "1 screen" : `${screenCount} screens`} ·{" "}
                  {dimensionCount === 1 ? "1 dimension" : `${dimensionCount} dimensions`}
                </span>
              </summary>
              <div className="mt-3 space-y-3">
                <form action={saveGroup} className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                  <input type="hidden" name="id" value={group.id} />
                  <input className="field" name="name" defaultValue={group.name} aria-label="Group name" />
                  <input className="field" name="description" defaultValue={group.description} aria-label="Description" />
                  <input type="hidden" name="active" value={group.isActive ? "0" : "1"} />
                  <button className="btn-quiet" type="submit">Save name</button>
                  <span className="inline-flex items-center">
                    <button className="btn-quiet" formAction={setGroupActive} type="submit">
                      {group.isActive ? "Disable" : "Enable"}
                    </button>
                    <HelpTip text="Disable keeps the group, its members, and its permissions, and stops it from being offered for new workflow steps." />
                  </span>
                </form>
                <p className="text-sm">
                  <span className="font-semibold">Members: </span>
                  {members.length ? (
                    members.map((member, index) => (
                      <span key={member.id}>
                        {index ? ", " : ""}
                        <Link className={member.isActive ? "text-pine" : "text-muted"} href={`/admin/users/${member.id}`}>{member.name}</Link>
                      </span>
                    ))
                  ) : (
                    <span className="text-muted">none yet. Add people to the group on their page in Users.</span>
                  )}
                </p>
                <ScopeAssignments
                  subjectType="GROUP"
                  subjectId={group.id}
                  returnTo={`/admin/access?open=${group.id}`}
                  scopes={scopes}
                  assignedIds={scopeGrants.filter((row) => row.subjectId === group.id).map((row) => row.scopeId)}
                  inherited={[]}
                  canEdit={canEdit}
                />
                <GroupPermissionsForm groupId={group.id} screens={screens} dimensions={dimensions} />
              </div>
            </details>
          );
        })}
      </fieldset>
    </div>
  );
}
