import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AI_PRODUCTS, oauthMessage, OAUTH_QUERY_COOKIE, openOauthQuery, originFromHeaders, parseAuthorizeQuery } from "@/lib/mcp-oauth";
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

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-md p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-pine">{name}</p>
        <h1 className="mt-2 text-2xl font-semibold">Connect an assistant</h1>
        {message ? <p className="mt-4 text-sm text-muted">{message}</p> : null}
        {!message && client?.ok ? (
          <form action="/oauth/decision" method="post" className="mt-4 space-y-4">
            <p className="text-sm">
              <span className="font-semibold">{client.client.name}</span>
              <span className="text-muted"> ({AI_PRODUCTS[client.product].label}) wants to connect as {user.name}. It will be sent back to {redirectHost}.</span>
            </p>
            {allowed ? null : <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">Your account cannot use AI access.</p>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="read" defaultChecked disabled={!allowed} />
              View records
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="propose" disabled={!canPropose} />
              Propose changes
            </label>
            <p className="text-sm text-muted">View starts on. Propose stays off until you turn it on. You can change either one later on AI access. A proposal is not saved until a person approves it.</p>
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
