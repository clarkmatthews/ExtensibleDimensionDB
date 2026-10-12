import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_LABELS, AI_PRODUCTS, oauthMessage, OAUTH_QUERY_COOKIE, openOauthQuery, originFromHeaders, parseAuthorizeQuery } from "@/lib/mcp-oauth";
import { resolveOauthClient } from "@/lib/mcp-oauth-flow";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { siteName } from "@/lib/site";

export const metadata = { title: "Connect an assistant" };

export default async function ConsentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const name = await siteName();
  const query = openOauthQuery((await cookies()).get(OAUTH_QUERY_COOKIE)?.value);
  const origin = originFromHeaders(await headers());
  const parsed = query ? parseAuthorizeQuery(new URLSearchParams(query), origin) : null;
  const client = parsed?.ok ? await resolveOauthClient(parsed) : null;
  const message = !query ? oauthMessage("expired") : !parsed?.ok ? oauthMessage("invalid") : client && !client.ok ? oauthMessage(client.reason) : null;
  const access = message ? null : await loadAccess(user);
  const allowed = access ? canViewModule(access, "AI_ACCESS") : false;
  const canPropose = Boolean(access && allowed && canEditModule(access, "AI_ACCESS") && canEditModule(access, "STORES"));
  const redirectHost = parsed?.ok ? new URL(parsed.redirectUri).hostname : "";
  const product = client?.ok ? AI_PRODUCTS[client.product].label : "";
  const assistant = client?.ok ? client.client.name : "";
  const named = assistant && assistant !== product ? `${assistant} (${product})` : product;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-md p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-pine">{name}</p>
        <h1 className="mt-2 text-2xl font-semibold">{client?.ok && !message ? `Connect ${product}` : "Connect an assistant"}</h1>
        {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
        {!message && client?.ok ? (
          <form action="/oauth/decision" method="post" className="mt-4 space-y-5">
            <p className="text-sm">
              {named} will use this database as <span className="font-semibold">{user.name}</span>. It sees only the records and attributes you can see.
            </p>
            {allowed ? null : <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">Your account cannot use AI access. Ask an administrator for access.</p>}
            <fieldset className="space-y-2" disabled={!allowed}>
              <legend className="label">What it can do</legend>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-line p-3 has-[:checked]:border-pine has-[:checked]:bg-slate-50">
                <input type="radio" name="access" value="view" defaultChecked className="mt-1" />
                <span>
                  <span className="block text-sm font-semibold">{ACCESS_LABELS.view}</span>
                  <span className="block text-sm text-muted">Answer questions from your records.</span>
                </span>
              </label>
              <label className={`flex gap-3 rounded-lg border border-line p-3 has-[:checked]:border-pine has-[:checked]:bg-slate-50 ${canPropose ? "cursor-pointer" : "opacity-60"}`}>
                <input type="radio" name="access" value="propose" disabled={!canPropose} className="mt-1" />
                <span>
                  <span className="block text-sm font-semibold">{ACCESS_LABELS.propose}</span>
                  <span className="block text-sm text-muted">
                    {canPropose
                      ? "Also suggest changes. Nothing is saved until a reviewer approves it."
                      : "Needs edit access to AI access and to Dimension."}
                  </span>
                </span>
              </label>
            </fieldset>
            <p className="text-xs text-muted">
              You can change this or disconnect at any time on AI access. After you choose, you return to {redirectHost}.
            </p>
            <div className="flex gap-3">
              <button className="btn" type="submit" name="decision" value="approve" disabled={!allowed}>Allow</button>
              <button className="btn-quiet" type="submit" name="decision" value="deny">Cancel</button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
