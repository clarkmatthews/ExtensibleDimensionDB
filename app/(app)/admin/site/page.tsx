import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { saveSiteName } from "@/lib/site-actions";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { MAX_IDLE_MINUTES, sessionIdleMinutes, siteName } from "@/lib/site";

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
  const [name, idleLimit] = await Promise.all([siteName(), sessionIdleMinutes()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Site
          <HelpTip text="The site name appears in the header, on the sign-in page, in the browser title, and at the start of action and test email subjects. The sender name on Email Config is separate. The sign-out time decides how long a browser can sit unused before its sign-in ends." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Set the name people see for this database and when idle sign-ins end.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {params.saved ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Site settings saved.</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view these settings. Edit access is required to change them.</p> : null}
      <form action={saveSiteName} className="panel max-w-xl space-y-4 p-4">
        <fieldset disabled={!canEdit} className="space-y-4">
          <label>
            <span className="label">
              Site name <HelpTip text="Shown in the header and on the sign-in page. Up to 80 characters." />
            </span>
            <input className="field" name="name" defaultValue={name} maxLength={80} required />
          </label>
          <label>
            <span className="label">
              Sign out after inactivity (minutes){" "}
              <HelpTip text="A browser sign-in ends after this many minutes with no typing, clicking, scrolling, or page loads, in any open tab. Two minutes before, a notice offers Stay signed in. Enter 0 to never sign people out for inactivity. AI assistants connected through AI access use their own tokens and are not signed out." />
            </span>
            <input
              className="field w-40"
              name="sessionIdleMinutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_IDLE_MINUTES}
              step={1}
              defaultValue={idleLimit}
              required
            />
            <span className="mt-1 block text-xs text-muted">
              {idleLimit > 0
                ? `People are signed out after ${idleLimit} ${idleLimit === 1 ? "minute" : "minutes"} without activity. 0 turns this off.`
                : "Off: people stay signed in until they sign out or their sign-in expires after 12 days."}{" "}
              AI connections are not affected.
            </span>
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
