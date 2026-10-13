import Link from "next/link";
import { redirect } from "next/navigation";
import { changeOwnPassword } from "@/app/account/password/actions";
import { logout } from "@/app/login/actions";
import { PASSWORD_RULES } from "@/lib/passwords";
import { managesOwnPassword, mustChooseOwnPassword } from "@/lib/password-policy";
import { getCurrentUser } from "@/lib/session";
import { siteName } from "@/lib/site";
import { loadSsoSettings } from "@/lib/sso";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sso = await loadSsoSettings().catch(() => null);
  if (!managesOwnPassword(user, sso)) redirect("/dashboard");
  const forced = mustChooseOwnPassword(user, sso);
  const params = await searchParams;
  const name = await siteName();
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="panel w-full max-w-md p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-pine">{name}</p>
        <h1 className="mt-2 text-2xl font-semibold">{forced ? "Choose your own password" : "Change password"}</h1>
        <p className="mt-2 text-sm text-muted">
          {forced
            ? `Welcome, ${user.name}. Your password was set by an administrator, so choose one only you know before you continue.`
            : `Signed in as ${user.email}. Changing your password signs you out of your other browsers.`}
        </p>
        {params.error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
        {params.saved ? <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Your password was changed.</p> : null}
        <form action={changeOwnPassword}>
          {/* Lets password managers save the new password against the right account. */}
          <input type="email" name="username" value={user.email} autoComplete="username" readOnly hidden />
          <label className="mt-6 block">
            <span className="label">{forced ? "Password you were given" : "Current password"}</span>
            <input className="field" name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          <label className="mt-4 block">
            <span className="label">New password</span>
            <input className="field" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          </label>
          <label className="mt-4 block">
            <span className="label">Confirm new password</span>
            <input className="field" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          </label>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
            {PASSWORD_RULES.map((rule) => (
              <li key={rule}>{rule.replace("the person's", "your")}</li>
            ))}
          </ul>
          <button className="btn mt-6 w-full" type="submit">
            {forced ? "Save and continue" : "Change password"}
          </button>
        </form>
        {forced ? (
          <form action={logout} className="mt-3 text-center">
            <button className="text-sm font-semibold text-pine" type="submit">Sign out</button>
          </form>
        ) : (
          <p className="mt-4 text-center text-sm">
            <Link className="font-semibold text-pine" href="/dashboard">Back to the dashboard</Link>
          </p>
        )}
      </div>
    </div>
  );
}
