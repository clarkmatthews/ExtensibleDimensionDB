import { headers } from "next/headers";
import { originFromHeaders } from "@/lib/public-origin";
import { redirect } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { saveSsoSettings, testSsoSettings } from "@/lib/sso-actions";
import { loadSsoSettings } from "@/lib/sso";

export const metadata = { title: "Single sign-on" };

export default async function SsoPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; tested?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "SSO")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "SSO");
  const params = await searchParams;
  const [settings, groups] = await Promise.all([
    loadSsoSettings(),
    prisma.group.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const callback = new URL("/api/auth/oidc/callback", originFromHeaders(await headers())).toString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Single sign-on
          <HelpTip text="Let people sign in with your identity provider through OpenID Connect: Microsoft Entra ID, Google Workspace, Okta, Auth0, Keycloak, and others. Password sign-in keeps working unless you limit it to administrators." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Register this app with your provider as a web application, with the redirect URI below, then enter the issuer, client ID, and client secret it gives you.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {params.saved ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Single sign-on saved.</p> : null}
      {params.tested ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Discovery worked. Issuer: {params.tested}</p> : null}

      <section className="panel space-y-2 p-4">
        <span className="label flex items-center">
          Redirect URI
          <HelpTip text="Register exactly this address with the provider. Set APP_URL in .env when the app is behind a proxy or has a public address different from the one in your browser." />
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <input className="field flex-1 font-mono" readOnly value={callback} />
          <CopyButton value={callback} label="Copy" />
        </div>
        {!process.env.APP_URL ? <p className="text-xs text-warn">APP_URL is not set, so this address comes from your browser. Set APP_URL for production.</p> : null}
      </section>

      <form action={saveSsoSettings} className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="md:col-span-2 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? false} disabled={!canEdit} />
          Turn on single sign-on
        </label>
        <label className="md:col-span-2">
          <span className="label flex items-center">
            Issuer
            <HelpTip text="The provider's issuer URL. Entra ID: https://login.microsoftonline.com/<tenant id>/v2.0. Google: https://accounts.google.com. Okta: https://<your domain>.okta.com. The app reads /.well-known/openid-configuration from it." />
          </span>
          <input className="field font-mono" name="issuer" defaultValue={settings?.issuer ?? ""} placeholder="https://login.microsoftonline.com/<tenant id>/v2.0" disabled={!canEdit} />
        </label>
        <label>
          <span className="label">Client ID</span>
          <input className="field font-mono" name="clientId" defaultValue={settings?.clientId ?? ""} disabled={!canEdit} />
        </label>
        <label>
          <span className="label flex items-center">
            Client secret
            <HelpTip text="Stored encrypted and never shown again. Leave blank to keep the saved secret." />
          </span>
          <input className="field font-mono" name="clientSecret" type="password" autoComplete="off" placeholder={settings?.clientSecret ? "Saved; leave blank to keep" : ""} disabled={!canEdit} />
        </label>
        <label>
          <span className="label">Button label</span>
          <input className="field" name="buttonLabel" defaultValue={settings?.buttonLabel ?? "Sign in with SSO"} disabled={!canEdit} />
        </label>
        <label>
          <span className="label flex items-center">
            Allowed email domains
            <HelpTip text="Separate with spaces or commas, for example example.com example.org. Leave empty to allow any email the provider verifies. With a tenant-specific issuer, the provider already limits who can sign in." />
          </span>
          <input className="field" name="allowedDomains" defaultValue={settings?.allowedDomains.join(", ") ?? ""} disabled={!canEdit} />
        </label>
        <label className="md:col-span-2 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="createUsers" defaultChecked={settings?.createUsers ?? false} disabled={!canEdit} />
          Create an account on first sign-in
          <HelpTip text="When someone with an allowed email signs in for the first time, create their account and add them to the group below. Otherwise an administrator adds people on Users first, and they sign in with the same email." />
        </label>
        <label>
          <span className="label">Group for new accounts</span>
          <select className="field" name="defaultGroupId" defaultValue={settings?.defaultGroupId ?? ""} disabled={!canEdit}>
            <option value="">No group</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <label className="md:col-span-2 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="passwordAdminOnly" defaultChecked={settings?.passwordAdminOnly ?? false} disabled={!canEdit || !user.isAdmin} />
          Only administrators can sign in with a password
          <HelpTip text="Everyone else must use single sign-on. Administrators keep password sign-in so a provider outage cannot lock everyone out." />
        </label>
        {canEdit ? (
          <div className="md:col-span-2 flex gap-2">
            <button className="btn" type="submit">Save</button>
            <button className="btn-quiet" type="submit" formAction={testSsoSettings}>Test saved settings</button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
