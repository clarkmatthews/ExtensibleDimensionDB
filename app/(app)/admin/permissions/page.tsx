import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { PermissionSubjectPicker } from "@/components/permission-subject-picker";
import { savePermissions } from "@/lib/access-actions";
import { NAV_MODULES } from "@/lib/nav-modules";
import { canEditModule, canViewModule, categoryAccess, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export default async function PermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ subjectType?: string; subjectId?: string; error?: string; saved?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const access = await loadAccess(user);
  if (!canViewModule(access, "PERMISSIONS")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "PERMISSIONS");
  const [groups, users, categories] = await Promise.all([
    prisma.group.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { fields: { orderBy: { sortOrder: "asc" } }, permissions: true },
    }),
  ]);
  const subjectType = params.subjectType === "GROUP" ? "GROUP" : "USER";
  const isGroup = subjectType === "GROUP";
  const options = isGroup ? groups : users;
  const subjectId = options.some((item) => item.id === params.subjectId) ? params.subjectId! : (options[0]?.id ?? "");
  const visibleCategories = categories.filter((category) => user.isAdmin || categoryAccess(access, category.id).canAssignPermissions);
  const [fieldPerms, categoryPerms, modulePerms] = subjectId
    ? await Promise.all([
        prisma.fieldPermission.findMany({ where: { subjectType, subjectId } }),
        prisma.categoryPermission.findMany({ where: { subjectType, subjectId } }),
        prisma.modulePermission.findMany({ where: { subjectType, subjectId } }),
      ])
    : [[], [], []];
  const subjectIsAdmin = !isGroup && users.some((account) => account.id === subjectId && account.isAdmin);

  return (
    <div className="space-y-4">
      <h1 className="flex items-center text-2xl font-semibold">
        Permissions
        <HelpTip text="Choose a user or a group. A person's own grant overrides their groups; a person in several groups gets the combined access. Update on an attribute also allows viewing it. Administrators always have edit access to every page." />
      </h1>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {params.saved ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Permissions saved.</p> : null}
      <p className="max-w-3xl text-sm text-muted">
        Choose a user or a group. A person&apos;s own grant overrides their groups, and a person in several groups gets the combined access. A group&apos;s view and edit access to dimensions and attributes is set on{" "}
        <Link className="font-semibold text-pine" href="/admin/access">Access</Link>. Update on an attribute also allows viewing it.
      </p>
      <PermissionSubjectPicker
        subjectType={subjectType}
        subjectId={subjectId}
        groups={groups.map((item) => ({ id: item.id, label: item.name }))}
        users={users.map((item) => ({ id: item.id, label: `${item.name} (${item.email})` }))}
      />
      {subjectId ? (
        <form action={savePermissions} className="space-y-4">
          <fieldset disabled={!canEdit} className="min-w-0 space-y-4 border-0 p-0">
          <input type="hidden" name="subjectType" value={subjectType} />
          <input type="hidden" name="subjectId" value={subjectId} />
          <input type="hidden" name="saveNavigation" value="1" />
          <section className="panel space-y-3 p-4">
            <h2 className="flex items-center font-semibold">
              Screens
              <HelpTip text={isGroup ? "Members can open the screens set to View or Edit. A person's own setting overrides their groups." : "From groups uses this person's groups. None, View, or Edit overrides their groups for that screen."} />
            </h2>
            <p className="text-sm text-muted">
              {isGroup
                ? "Members can open screens set to View, and change things on screens set to Edit. A person in several groups gets the higher level. Administrators always have edit for every screen."
                : "From groups gives this person what their groups allow. None, View, or Edit sets this person's own access and overrides their groups. Administrators always have edit for every screen."}
            </p>
            {subjectIsAdmin ? (
              <p className="text-sm text-muted">This person is an administrator, so these choices apply only if that access is removed.</p>
            ) : null}
            <NavigationChoices modulePerms={modulePerms} inherit={!isGroup} />
          </section>
          {visibleCategories.map((category) => {
            const grant = categoryPerms.find((row) => row.categoryId === category.id);
            return (
              <section key={category.id} className="panel p-4">
                <h2 className="font-semibold">{category.name}</h2>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <Check name={`cat:${category.id}:add`} label="Add attributes" checked={grant?.canAddFields} help="Create new attributes in this dimension." />
                  <Check name={`cat:${category.id}:remove`} label="Hide attributes" checked={grant?.canRemoveFields} help="Deactivate an attribute so it leaves the dimension editor. The stored values stay." />
                  <Check name={`cat:${category.id}:edit`} label="Edit attributes" checked={grant?.canEditFields} help="Change an attribute's definition, such as its type, pattern, and default." />
                  <Check name={`cat:${category.id}:category`} label="Edit dimension" checked={grant?.canEditCategory} help="Rename this dimension, change its description, and reorder it." />
                  <Check name={`cat:${category.id}:assign`} label="Assign permissions" checked={grant?.canAssignPermissions} help="Grant this dimension to other people." />
                  {isGroup ? null : <Check name={`cat:${category.id}:view`} label="View data" checked={grant?.canViewData} help="See values in this dimension. An attribute still needs its own view grant." />}
                </div>
                {isGroup ? (
                  <p className="mt-2 text-sm text-muted">
                    View and edit access for this group is set on <Link className="font-semibold text-pine" href="/admin/access">Access</Link>.
                  </p>
                ) : <div className="mt-3 space-y-1 text-sm">
                  {category.fields.map((field) => {
                    const fieldGrant = fieldPerms.find((row) => row.fieldId === field.id);
                    return (
                      <div key={field.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
                        <span>{field.friendlyName}</span>
                        <span className="flex gap-3">
                          <Check name={`field:${field.id}:view`} label="View" checked={fieldGrant?.canView} help="See this attribute on a dimension. The dimension still needs View data." />
                          <Check name={`field:${field.id}:update`} label="Update" checked={fieldGrant?.canUpdate} help="Change this attribute's value. Update also allows viewing it." />
                        </span>
                      </div>
                    );
                  })}
                </div>}
              </section>
            );
          })}
          {canEdit ? <button className="btn" type="submit">Save permissions</button> : (
            <p className="text-sm text-muted">You can view these permissions. Edit access is required to change them.</p>
          )}
          </fieldset>
        </form>
      ) : (
        <p className="text-sm text-muted">
          {isGroup ? "Create a group on Access before assigning permissions." : "Create a user before assigning permissions."}
        </p>
      )}
    </div>
  );
}

function NavigationChoices({ modulePerms, inherit }: { modulePerms: { module: string; grantLevel: string }[]; inherit: boolean }) {
  const choices = inherit ? (["INHERIT", "NONE", "VIEW", "EDIT"] as const) : (["NONE", "VIEW", "EDIT"] as const);
  const labels: Record<string, string> = { INHERIT: "From groups", NONE: "None", VIEW: "View", EDIT: "Edit" };
  return (
    <div className="space-y-2">
      {NAV_MODULES.map((item, index) => {
        const previousGroup: string = index > 0 ? NAV_MODULES[index - 1].group : "";
        const header = item.group && item.group !== previousGroup ? item.group : "";
        const stored = modulePerms.find((row) => row.module === item.id)?.grantLevel;
        const level = stored ?? (inherit ? "INHERIT" : "NONE");
        return (
          <div key={item.id}>
            {header ? <p className="pt-2 text-sm font-semibold">{header}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm">
              <span>{item.label}</span>
              <span className="flex flex-wrap gap-3">
                {choices.map((choice) => (
                  <label key={choice} className="flex items-center gap-2">
                    <input type="radio" name={`nav:${item.id}`} value={choice} defaultChecked={level === choice} />
                    {labels[choice]}
                  </label>
                ))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Check({ name, label, checked, help }: { name: string; label: string; checked?: boolean; help?: string }) {
  return (
    <label className="flex items-center gap-2">
      <input name={name} type="checkbox" defaultChecked={Boolean(checked)} />
      {label}
      {help ? <HelpTip text={help} /> : null}
    </label>
  );
}
