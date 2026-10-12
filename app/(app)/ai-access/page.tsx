import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { readNewAccessToken } from "@/lib/ai-access-cookie";
import { createAccessToken, disconnectOauthConnection, revokeAccessToken, saveOauthProducts, updateOauthConnection } from "@/lib/ai-access-actions";
import { enabledProductLabels, AI_PRODUCTS, OAUTH_OFF } from "@/lib/mcp-oauth";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "AI access" };

const SAVED: Record<string, string> = {
  created: "Token created. Copy it now; it is shown only once.",
  revoked: "Token revoked.",
  products: "Assistant sign-in updated.",
  connection: "Connection updated.",
  disconnected: "Assistant disconnected.",
};

function tokenState(token: { revokedAt: Date | null; expiresAt: Date | null }) {
  if (token.revokedAt) return "Revoked";
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return "Expired";
  return token.expiresAt ? `Expires ${token.expiresAt.toLocaleDateString()}` : "Does not expire";
}

export default async function AiAccessPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "AI_ACCESS")) return <ModuleDenied />;
  const canPropose = canEditModule(access, "AI_ACCESS") && canEditModule(access, "STORES");
  const params = await searchParams;
  const fresh = await readNewAccessToken();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const endpoint = `${proto}://${host}/api/mcp`;
  const [mine, everyone, settings, connections, otherConnections] = await Promise.all([
    prisma.accessToken.findMany({ where: { userId: user.id, connectionId: null }, orderBy: { createdAt: "desc" } }),
    user.isAdmin
      ? prisma.accessToken.findMany({
          where: { userId: { not: user.id }, revokedAt: null, connectionId: null },
          orderBy: { createdAt: "desc" },
          include: { user: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
    prisma.aiOauthSettings.findUnique({ where: { id: "default" } }),
    prisma.oauthConnection.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    user.isAdmin
      ? prisma.oauthConnection.findMany({
          where: { userId: { not: user.id }, revokedAt: null },
          orderBy: { createdAt: "desc" },
          include: { user: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const shown = fresh && mine.some((token) => token.id === fresh.tokenId) ? fresh.token : null;
  const sample = shown ?? "edb_your_token";
  const oauth = settings ?? OAUTH_OFF;
  const enabled = enabledProductLabels(oauth);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          AI access
          <HelpTip text="Connect an AI assistant such as Claude, ChatGPT, Grok, or Cursor to this database as you. It sees only what you are allowed to see. With proposals turned on, it can suggest changes that wait for a person to approve them." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Create a token, or let ChatGPT, Claude, or Grok sign in with OAuth. The assistant answers from the records and attributes your account can view.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {SAVED[params.saved ?? ""] ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">{SAVED[params.saved ?? ""]}</p> : null}

      {shown ? (
        <section className="panel space-y-2 p-4">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-warn">Copy this token now. It is shown only once and is not stored.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input className="field flex-1 font-mono" readOnly value={shown} />
            <CopyButton value={shown} label="Copy token" />
          </div>
        </section>
      ) : null}

      <section className="panel space-y-3 p-4">
        <h2 className="flex items-center text-lg font-semibold">
          Assistants that can sign in
          <HelpTip text="Each assistant is off until an administrator turns it on. Turning one off blocks new sign-ins and stops its existing connections. Pasted tokens keep working." />
        </h2>
        {user.isAdmin ? (
          <form action={saveOauthProducts} className="flex flex-wrap items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2"><input type="checkbox" name="chatgpt" defaultChecked={oauth.allowChatGpt} /> ChatGPT</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" name="claude" defaultChecked={oauth.allowClaude} /> Claude</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" name="grok" defaultChecked={oauth.allowGrok} /> Grok</label>
            <button className="btn" type="submit">Save</button>
          </form>
        ) : (
          <p className="text-sm text-muted">
            {enabled.length ? `OAuth sign-in is on for ${enabled.join(", ")}.` : "OAuth sign-in is off until an administrator turns on ChatGPT, Claude, or Grok."}
          </p>
        )}
      </section>

      <section className="panel space-y-3 p-4">
        <h2 className="text-lg font-semibold">Connect an assistant</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input className="field flex-1 font-mono" readOnly value={endpoint} />
          <CopyButton value={endpoint} label="Copy URL" />
        </div>
        <p className="text-sm">
          For ChatGPT, Claude on the web, or Grok, add this URL and choose OAuth. You sign in here and choose view records and proposing changes. Claude Code, Cursor, and the Grok app can use a personal token instead.
        </p>
        <p className="text-sm">Claude Code:</p>
        <pre className="overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs">{`claude mcp add --transport http dimension-knowledge ${endpoint} --header "Authorization: Bearer ${sample}"`}</pre>
        <p className="text-sm">Grok:</p>
        <pre className="overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs">{`grok mcp add --transport http dimension-knowledge ${endpoint} --header "Authorization: Bearer ${sample}"`}</pre>
        <p className="text-sm">ChatGPT and the Grok API, with a personal token. Both call the URL from the internet, so it has to be a public address. The authorization value is sent as Authorization: Bearer.</p>
        <pre className="overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs">{JSON.stringify(
          { type: "mcp", server_label: "dimension-knowledge", server_url: endpoint, authorization: sample },
          null,
          2,
        )}</pre>
        <p className="text-sm">Cursor and other clients that read an mcpServers file:</p>
        <pre className="overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs">{JSON.stringify(
          { mcpServers: { "dimension-knowledge": { url: endpoint, headers: { Authorization: `Bearer ${sample}` } } } },
          null,
          2,
        )}</pre>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">OAuth connections</h2>
        {connections.length === 0 ? <p className="text-sm text-muted">No assistants have signed in yet.</p> : (
          <ul className="panel divide-y text-sm">
            {connections.map((connection) => (
              <li key={connection.id} className="px-4 py-2">
                <form action={updateOauthConnection} className="flex flex-wrap items-center gap-4">
                  <input type="hidden" name="id" value={connection.id} />
                  <span>
                    <span className="font-semibold">{connection.name}</span>
                    <span className="text-muted"> · {AI_PRODUCTS[connection.product].label}</span>
                  </span>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" name="read" defaultChecked={connection.allowRead} />
                    View records
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" name="propose" defaultChecked={connection.allowPropose} disabled={!canPropose} />
                    Propose changes
                  </label>
                  <button className="btn" type="submit">Update</button>
                  <button className="btn-quiet" type="submit" formAction={disconnectOauthConnection}>Disconnect</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel space-y-3 p-4">
        <h2 className="text-lg font-semibold">New token</h2>
        <form action={createAccessToken} className="flex flex-wrap items-end gap-3">
          <label>
            <span className="label">Name</span>
            <input className="field" name="name" required placeholder="Claude on my laptop" />
          </label>
          <label>
            <span className="label">Expires</span>
            <select className="field" name="expires" defaultValue="90">
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In a year</option>
              <option value="0">Never</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="propose" disabled={!canPropose} />
            Allow proposing changes
            <HelpTip text={canPropose ? "The assistant can submit changes to records. Nothing is saved until someone with AI proposals edit access approves it. Without this, the token is read-only." : "Needs edit access to AI access and to Dimension."} />
          </label>
          <button className="btn" type="submit">Create token</button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Your tokens</h2>
        {mine.length === 0 ? <p className="text-sm text-muted">No tokens yet.</p> : (
          <ul className="panel divide-y text-sm">
            {mine.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                <span>
                  <span className="font-semibold">{token.name}</span>
                  <span className="text-muted"> · <span className="font-mono">{token.prefix}…</span> · {token.scopes.includes("propose") ? "Read and propose" : "Read only"} · {tokenState(token)}
                    {token.lastUsedAt ? ` · last used ${token.lastUsedAt.toLocaleString()}` : " · never used"}</span>
                </span>
                {!token.revokedAt ? (
                  <form action={revokeAccessToken}>
                    <input type="hidden" name="id" value={token.id} />
                    <button className="btn-quiet" type="submit">Revoke</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {user.isAdmin && otherConnections.length ? (
        <section className="space-y-2">
          <h2 className="flex items-center text-lg font-semibold">
            Everyone&apos;s OAuth connections
            <HelpTip text="Administrators can disconnect anyone's assistant, for example when a session should stop immediately." />
          </h2>
          <ul className="panel divide-y text-sm">
            {otherConnections.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                <span>
                  <span className="font-semibold">{connection.user.name}</span>
                  <span className="text-muted"> · {connection.name} · {AI_PRODUCTS[connection.product].label} · {connection.allowRead ? "View" : "View off"}{connection.allowPropose ? " · Propose" : ""}</span>
                </span>
                <form action={disconnectOauthConnection}>
                  <input type="hidden" name="id" value={connection.id} />
                  <button className="btn-quiet" type="submit">Disconnect</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {user.isAdmin && everyone.length ? (
        <section className="space-y-2">
          <h2 className="flex items-center text-lg font-semibold">
            Everyone&apos;s active tokens
            <HelpTip text="Administrators can revoke anyone's token, for example when a laptop is lost." />
          </h2>
          <ul className="panel divide-y text-sm">
            {everyone.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                <span>
                  <span className="font-semibold">{token.user.name}</span>
                  <span className="text-muted"> · {token.name} · {token.scopes.includes("propose") ? "Read and propose" : "Read only"} · {tokenState(token)}</span>
                </span>
                <form action={revokeAccessToken}>
                  <input type="hidden" name="id" value={token.id} />
                  <button className="btn-quiet" type="submit">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
