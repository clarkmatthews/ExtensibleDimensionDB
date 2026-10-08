import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { saveUser } from "@/lib/access-actions";
import { PASSWORD_RULES } from "@/lib/passwords";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "USERS")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "USERS");
  const params = await searchParams;
  const [users, groups] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" }, include: { groups: { include: { group: true } } } }),
    prisma.group.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Users
          <HelpTip text="Each person signs in with an email and a password. Groups give them shared access and workflow actions. Open a user to set dimension permissions and assign workflow steps." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Each person signs in with an email address and a password. After an account is created, open it to grant dimension permissions and assign workflow steps.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {canEdit ? (
      <form action={saveUser} className="panel space-y-4 p-4">
        <h2 className="font-semibold">New user</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <span className="label">Name</span>
            <input className="field" name="name" autoComplete="name" required maxLength={100} />
          </label>
          <label>
            <span className="label">Email</span>
            <input className="field" name="email" type="email" autoComplete="off" required maxLength={254} />
          </label>
          <label>
            <span className="label">Password <HelpTip text="12 to 128 characters, with an uppercase letter, a lowercase letter, a number, and a symbol. It must not include the person's name or email." /></span>
            <input className="field" name="password" type="password" autoComplete="new-password" required />
          </label>
          <label>
            <span className="label">Confirm password</span>
            <input className="field" name="confirmPassword" type="password" autoComplete="new-password" required />
          </label>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {PASSWORD_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        {user.isAdmin ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input name="isAdmin" type="checkbox" /> Administrator <HelpTip text="An administrator can open and change every part of the product. Navigation and dimension grants do not limit them." /></label>
          <label className="flex items-center gap-2"><input name="canDefineWorkflows" type="checkbox" /> Can define structure and workflows <HelpTip text="Kept for earlier accounts. Page access is now set on Permissions. An administrator can still change this flag." /></label>
        </div>
        ) : null}
        {groups.length ? (
          <div className="flex flex-wrap gap-3 text-sm">
            {groups.map((group) => (
              <label key={group.id} className="flex items-center gap-2">
                <input name="groupId" type="checkbox" value={group.id} />
                {group.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Add a group on Access if this person should inherit group permissions or receive workflow actions.</p>
        )}
        <button className="btn" type="submit">Create user</button>
      </form>
      ) : (
        <p className="text-sm text-muted">You can view users. Edit access is required to change them.</p>
      )}
      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Groups</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((account) => (
              <tr key={account.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <Link className="font-semibold text-pine" href={`/admin/users/${account.id}`}>{account.name}</Link>
                  {account.isAdmin ? <span className="ml-2 text-xs text-muted">Admin</span> : null}
                </td>
                <td className="px-4 py-3">{account.email}</td>
                <td className="px-4 py-3">{account.groups.map((membership) => membership.group.name).join(", ") || "—"}</td>
                <td className="px-4 py-3">{account.isActive ? "Active" : "Disabled"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
