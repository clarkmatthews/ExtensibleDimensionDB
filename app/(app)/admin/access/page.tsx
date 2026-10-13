import Link from "next/link";
import { redirect } from "next/navigation";
import { GroupAccessForm, type GroupAccessLevel } from "@/components/group-access-form";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { saveGroup, setGroupActive } from "@/lib/access-actions";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const actorAccess = await loadAccess(user);
  if (!canViewModule(actorAccess, "ACCESS")) return <ModuleDenied />;
  const canEdit = canEditModule(actorAccess, "ACCESS");
  const params = await searchParams;
  const [groups, categories, categoryGrants, fieldGrants] = await Promise.all([
    prisma.group.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.categoryPermission.findMany({ where: { subjectType: "GROUP" } }),
    prisma.fieldPermission.findMany({ where: { subjectType: "GROUP" } }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Access
          <HelpTip text="Groups share access. Members receive the group's dimension and attribute access here, and its screen access on Permissions. A person in several groups gets the combined access. A grant made to the person on Permissions overrides their groups." />
        </h1>
        <p className="mt-1 text-sm text-muted">
          Groups supply shared access. A group can grant view or edit for a whole dimension or for individual attributes; its screens are set on{" "}
          <Link className="font-semibold text-pine" href="/admin/permissions?subjectType=GROUP">Permissions</Link>. People are managed on{" "}
          <Link className="font-semibold text-pine" href="/admin/users">Users</Link>.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {params.saved === "group" ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Group access saved.</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view groups. Edit access is required to change them.</p> : null}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-8 border-0 p-0">
      <section className="space-y-3">
        <h2 className="flex items-center text-lg font-semibold">
          Groups
          <HelpTip text="A group receives workflow actions and notices, and grants view or edit for a whole dimension or for individual attributes. Entire dimension also covers attributes added later. A person in several groups gets the combined access." />
        </h2>
        <form action={saveGroup} className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
          <input className="field" name="name" placeholder="Name" required />
          <input className="field" name="description" placeholder="Description" />
          <button className="btn" type="submit">Add</button>
        </form>
        {groups.map((group) => (
          <section key={group.id} className="panel space-y-3 p-3">
            <form action={saveGroup} className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
              <input type="hidden" name="id" value={group.id} />
              <input className="field" name="name" defaultValue={group.name} />
              <input className="field" name="description" defaultValue={group.description} />
              <input type="hidden" name="active" value={group.isActive ? "0" : "1"} />
              <button className="btn-quiet" type="submit">Save</button>
              <span className="inline-flex items-center">
                <button className="btn-quiet" formAction={setGroupActive} type="submit">
                  {group.isActive ? "Disable" : "Enable"}
                </button>
                <HelpTip text="Disable keeps the group and its grants, and stops it from receiving new workflow choices." />
              </span>
            </form>
            <p className="text-sm text-muted">
              {group._count.members === 1 ? "1 member" : `${group._count.members} members`} ·{" "}
              <Link className="font-semibold text-pine" href={`/admin/permissions?subjectType=GROUP&subjectId=${group.id}`}>Screens and dimension admin rights</Link>
            </p>
            <GroupAccessForm
              groupId={group.id}
              categories={categories.map((category) => {
                const grant = categoryGrants.find((row) => row.subjectId === group.id && row.categoryId === category.id);
                const categoryLevel: GroupAccessLevel =
                  grant?.grantLevel === "VIEW" || grant?.grantLevel === "EDIT" ? grant.grantLevel : "NONE";
                return {
                  id: category.id,
                  name: category.name,
                  grantLevel: categoryLevel,
                  applyToFields: grant?.applyToFields ?? false,
                  fields: category.fields.map((field) => {
                    const fieldGrant = fieldGrants.find((row) => row.subjectId === group.id && row.fieldId === field.id);
                    const level: GroupAccessLevel = fieldGrant?.canUpdate
                      ? "EDIT"
                      : fieldGrant?.canView
                        ? "VIEW"
                        : !grant?.applyToFields && categoryLevel !== "NONE"
                          ? categoryLevel
                          : "NONE";
                    return { id: field.id, friendlyName: field.friendlyName, isActive: field.isActive, level };
                  }),
                };
              })}
            />
          </section>
        ))}
      </section>
      </fieldset>
    </div>
  );
}
