import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { saveMailSettings, sendTestEmail } from "@/lib/mail-actions";
import { resolveMailSettings } from "@/lib/mail";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Email Config" };

export default async function EmailConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "EMAIL_CONFIG")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "EMAIL_CONFIG");
  const params = await searchParams;
  const { saved, settings } = await resolveMailSettings();
  const savedMessage =
    params.saved === "test" ? `Test message sent to ${user.email}.` : params.saved ? "Email settings saved." : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Email Config
          <HelpTip text="These settings are used when the app sends action and change messages by email. Messages are always stored in the app, even when email is off or the server cannot be reached." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Set the mail server, connection security, and the name and address messages are sent from.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {savedMessage ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">{savedMessage}</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view these settings. Edit access is required to change them.</p> : null}
      {!saved ? (
        <p className="text-sm text-muted">
          Nothing is saved yet. These values show the server environment, if one is set. Saving stores the configuration here.
        </p>
      ) : null}

      <form action={saveMailSettings} className="panel max-w-3xl space-y-4 p-4">
        <fieldset disabled={!canEdit} className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input name="enabled" type="checkbox" defaultChecked={settings.enabled} />
            Email enabled
            <HelpTip text="When this is off, messages stay in the app and no mail is sent." />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">
                Server <HelpTip text="The SMTP host name, such as smtp.example.com." />
              </span>
              <input className="field" name="host" defaultValue={settings.host} autoComplete="off" />
            </label>
            <label>
              <span className="label">
                Port <HelpTip text="Common ports are 587 for STARTTLS and 465 for TLS." />
              </span>
              <input className="field" name="port" type="number" min={1} max={65535} defaultValue={settings.port} />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">
                Security <HelpTip text="None sends without encryption. STARTTLS upgrades the connection after connecting, usually on port 587. TLS encrypts from the start, usually on port 465." />
              </span>
              <select className="field" name="security" defaultValue={settings.security}>
                <option value="NONE">None</option>
                <option value="STARTTLS">STARTTLS</option>
                <option value="TLS">TLS</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input name="rejectUnauthorized" type="checkbox" defaultChecked={settings.rejectUnauthorized} />
              Require a valid certificate
              <HelpTip text="Leave this on for a public mail server. Turn it off only for a server that uses a private or self-signed certificate." />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">
                Username <HelpTip text="Leave blank when the server does not require a sign-in." />
              </span>
              <input className="field" name="username" defaultValue={settings.username} autoComplete="off" />
            </label>
            <label>
              <span className="label">
                Password <HelpTip text="Stored encrypted. Leave blank to keep the saved password. Use Remove saved password to clear it." />
              </span>
              <input className="field" name="password" type="password" autoComplete="new-password" placeholder={settings.passwordSet ? "Saved" : ""} />
            </label>
          </div>
          {settings.passwordSet ? (
            <label className="flex items-center gap-2 text-sm">
              <input name="clearPassword" type="checkbox" />
              Remove saved password
            </label>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">
                Sender name <HelpTip text="The name recipients see. This is separate from the site name in the header." />
              </span>
              <input className="field" name="fromName" defaultValue={settings.fromName} />
            </label>
            <label>
              <span className="label">
                Sender address <HelpTip text="The mailbox the message is sent from." />
              </span>
              <input className="field" name="fromEmail" type="email" defaultValue={settings.fromEmail} />
            </label>
          </div>
          <label>
            <span className="label">
              Reply-to <HelpTip text="Optional address that receives replies. Leave blank to use the sender address." />
            </span>
            <input className="field" name="replyTo" type="email" defaultValue={settings.replyTo} />
          </label>
        </fieldset>
        {canEdit ? (
          <button className="btn" type="submit">
            Save
          </button>
        ) : null}
      </form>
      {canEdit ? (
        <form action={sendTestEmail}>
          <button className="btn-quiet" type="submit">
            Send test to {user.email}
          </button>
        </form>
      ) : null}
    </div>
  );
}
