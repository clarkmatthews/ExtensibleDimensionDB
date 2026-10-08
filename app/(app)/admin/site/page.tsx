import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { saveSiteName } from "@/lib/site-actions";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { siteName } from "@/lib/site";

export const metadata: Metadata = { title: "Site" };

export default async function SitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "SITE_CONFIG")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "SITE_CONFIG");
  const params = await searchParams;
  const name = await siteName();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Site
          <HelpTip text="This name appears in the header, on the sign-in page, in the browser title, and at the start of action and test email subjects. The sender name on Email Config is separate." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Set the name people see for this database.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {params.saved ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Site name saved.</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view this name. Edit access is required to change it.</p> : null}
      <form action={saveSiteName} className="panel max-w-xl space-y-4 p-4">
        <fieldset disabled={!canEdit} className="space-y-4">
          <label>
            <span className="label">
              Site name <HelpTip text="Shown in the header and on the sign-in page. Up to 80 characters." />
            </span>
            <input className="field" name="name" defaultValue={name} maxLength={80} required />
          </label>
        </fieldset>
        {canEdit ? (
          <button className="btn" type="submit">
            Save
          </button>
        ) : null}
      </form>
    </div>
  );
}
