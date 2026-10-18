import { redirect } from "next/navigation";
import { login } from "@/app/login/actions";
import { HelpTip } from "@/components/help-tip";
import { endedSessionReason, getCurrentUser, idleMinutes } from "@/lib/session";
import { siteName } from "@/lib/site";
import { ssoButton, SSO_MESSAGES, type SsoReason } from "@/lib/sso";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; wait?: string; reason?: string; idle?: string }>;
}) {
  const params = await searchParams;
  if (await getCurrentUser()) redirect("/dashboard");
  const ended = params.error ? null : params.idle === "1" ? "idle" : await endedSessionReason();
  const name = await siteName();
  const sso = await ssoButton();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form action={login} className="panel w-full max-w-md p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-pine">{name}</p>
        <h1 className="mt-2 flex items-center text-2xl font-semibold">
          Sign in
          <HelpTip text="Use the email and password for your account. An administrator creates additional accounts on Users." />
        </h1>
        <p className="mt-2 text-sm text-muted">
          Use the administrator account created for this local database, or an account an administrator added.
        </p>
        {ended === "idle" ? (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm" role="status">
            You were signed out after {idleMinutes()} minutes without activity. Sign in again to continue.
          </p>
        ) : null}
        {ended === "ended" ? (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm" role="status">Your sign-in has ended. Sign in again to continue.</p>
        ) : null}
        {params.error === "1" ? (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">Email or password was not recognized.</p>
        ) : null}
        {params.error === "locked" ? (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">
            Too many sign-in attempts. Try again in {waitText(params.wait)}.
          </p>
        ) : null}
        {params.error === "sso" ? (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">
            Single sign-on did not complete. {SSO_MESSAGES[params.reason as SsoReason] ?? ""}
          </p>
        ) : null}
        {params.error === "sso-only" ? (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">This account signs in with single sign-on. Use the button below.</p>
        ) : null}
        {params.error === "setup" ? (
          <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">
            <p>The database is connected, but the tables have not been created. This account is not allowed to create them.</p>
            <p className="mt-2">Run this as a PostgreSQL superuser, then sign in again:</p>
            <p className="mt-2 break-all font-mono text-xs text-ink">GRANT USAGE, CREATE ON SCHEMA public TO &quot;dimensionUser&quot;;</p>
          </div>
        ) : null}
        <label className="mt-6 block">
          <span className="label">Email</span>
          <input className="field" name="email" type="email" autoComplete="username" required />
        </label>
        <label className="mt-4 block">
          <span className="label">Password</span>
          <input className="field" name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn mt-6 w-full" type="submit">
          Sign in
        </button>
        {sso ? (
          <>
            <p className="mt-4 text-center text-xs text-muted">or</p>
            <a className="btn-quiet mt-2 w-full justify-center py-2 font-semibold" href="/api/auth/oidc/start">{sso.label}</a>
          </>
        ) : null}
      </form>
    </div>
  );
}

function waitText(raw: string | undefined) {
  const minutes = Math.min(Math.max(Number.parseInt(raw ?? "", 10) || 1, 1), 60);
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
}
