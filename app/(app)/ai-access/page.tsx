import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { SetupTabs, type SetupTab } from "@/components/setup-tabs";
import { readNewAccessToken } from "@/lib/ai-access-cookie";
import { createAccessToken, disconnectOauthConnection, revokeAccessToken, saveOauthProducts, updateOauthConnection } from "@/lib/ai-access-actions";
import { ACCESS_LABELS, accessLabel, AI_PRODUCTS, mcpResource, OAUTH_OFF, originFromHeaders, productEnabled, type AiProduct } from "@/lib/mcp-oauth";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "AI access" };

const SAVED: Record<string, string> = {
  created: "Token created. Copy it now; it is shown only once.",
  revoked: "Token revoked.",
  products: "Chat assistant sign-in updated.",
  connection: "Access updated. The assistant uses it from its next request.",
  disconnected: "Assistant disconnected.",
};

const PRODUCTS: AiProduct[] = ["CHATGPT", "CLAUDE", "GROK"];

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
function when(date: Date | null, never = "Not used yet") {
  if (!date) return never;
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}

function tokenState(token: { revokedAt: Date | null; expiresAt: Date | null }) {
  if (token.revokedAt) return "Revoked";
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return "Expired";
  return token.expiresAt ? `Expires ${token.expiresAt.toLocaleDateString()}` : "Does not expire";
}

/** The assistant's name, and the product only when the name doesn't already say it. */
function assistantName(connection: { name: string; product: AiProduct }) {
  const product = AI_PRODUCTS[connection.product].label;
  return connection.name === product ? product : `${connection.name} (${product})`;
}

function StatusChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-line bg-slate-50 text-slate-500"}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-600" : "bg-slate-400"}`} />
      {label} <span className="sr-only">is</span> {on ? "on" : "off"}
    </span>
  );
}

function setupTabs(endpoint: string, token: string): SetupTab[] {
  const header = `Authorization: Bearer ${token}`;
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      intro: "Run this in a terminal.",
      code: `claude mcp add --transport http dimension-knowledge ${endpoint} \\\n  --header "${header}"`,
    },
    {
      id: "cursor",
      label: "Cursor",
      intro: "Add this to mcp.json. Other clients that read an mcpServers file use the same shape.",
      code: JSON.stringify({ mcpServers: { "dimension-knowledge": { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    },
    {
      id: "grok-cli",
      label: "Grok CLI",
      intro: "Run this in a terminal.",
      code: `grok mcp add --transport http dimension-knowledge ${endpoint} \\\n  --header "${header}"`,
    },
    {
      id: "api",
      label: "API",
      intro: "Add this tool to an OpenAI Responses API or xAI API request.",
      code: JSON.stringify({ type: "mcp", server_label: "dimension-knowledge", server_url: endpoint, authorization: token }, null, 2),
      note: "These services call the URL from the internet, so it has to be a public address.",
    },
  ];
}

export default async function AiAccessPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "AI_ACCESS")) return <ModuleDenied />;
  const canPropose = canEditModule(access, "AI_ACCESS") && canEditModule(access, "STORES");
  const params = await searchParams;
  const fresh = await readNewAccessToken();
  // The same address the OAuth metadata advertises, so a pasted URL matches the sign-in resource.
  const endpoint = mcpResource(originFromHeaders(await headers()));
  const [mine, settings, connections, allConnections, allTokens] = await Promise.all([
    prisma.accessToken.findMany({ where: { userId: user.id, connectionId: null, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.aiOauthSettings.findUnique({ where: { id: "default" } }),
    prisma.oauthConnection.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    user.isAdmin
      ? prisma.oauthConnection.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } })
      : Promise.resolve([]),
    user.isAdmin
      ? prisma.accessToken.findMany({ where: { connectionId: null, revokedAt: null }, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } })
      : Promise.resolve([]),
  ]);
  const shown = fresh && mine.some((token) => token.id === fresh.tokenId) ? fresh.token : null;
  const oauth = settings ?? OAUTH_OFF;
  const anyEnabled = PRODUCTS.some((product) => productEnabled(oauth, product));
  const everyone = [
    ...allConnections.map((connection) => ({
      key: `c-${connection.id}`,
      person: connection.user.name,
      name: assistantName(connection),
      type: "Chat sign-in",
      access: accessLabel(connection.allowPropose),
      status: `Connected ${connection.createdAt.toLocaleDateString()}`,
      lastUsed: when(connection.lastUsedAt),
      id: connection.id,
      action: "disconnect" as const,
    })),
    ...allTokens.map((token) => ({
      key: `t-${token.id}`,
      person: token.user.name,
      name: token.name,
      type: "Token",
      access: accessLabel(token.scopes.includes("propose")),
      status: tokenState(token),
      lastUsed: when(token.lastUsedAt),
      id: token.id,
      action: "revoke" as const,
    })),
  ].sort((left, right) => left.person.localeCompare(right.person) || left.type.localeCompare(right.type));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          AI access
          <HelpTip text="Connect an AI assistant to this database as you. It sees only what you are allowed to see. With View and propose, it can suggest changes that wait for a person to approve them." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Connect your AI assistant to this database. It answers from the records and attributes your account can see, and any change it proposes waits for a person to approve it.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {SAVED[params.saved ?? ""] ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">{SAVED[params.saved ?? ""]}</p> : null}

      <section className="panel space-y-2 p-4">
        <h2 className="text-sm font-semibold">Connection URL</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input className="field flex-1 font-mono" readOnly value={endpoint} aria-label="Connection URL" />
          <CopyButton value={endpoint} label="Copy URL" />
        </div>
        <p className="text-xs text-muted">Both ways of connecting below use this address.</p>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="panel min-w-0 space-y-5 p-5" aria-labelledby="chat-heading">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="chat-heading" className="text-lg font-semibold">Chat assistants</h2>
              <span className="rounded-full bg-pine px-2 py-0.5 text-xs font-semibold text-white">Recommended</span>
            </div>
            <p className="text-sm text-muted">ChatGPT, Claude, and Grok on the web sign in with OAuth. There is no key to copy, store, or rotate.</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Which chat assistants can sign in">
            {PRODUCTS.map((product) => (
              <StatusChip key={product} label={AI_PRODUCTS[product].label} on={productEnabled(oauth, product)} />
            ))}
          </div>
          {anyEnabled ? null : (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-warn">
              {user.isAdmin ? "Turn on at least one assistant under Administration below." : "An administrator needs to turn on an assistant before anyone can sign in."}
            </p>
          )}
          <ol className="space-y-3 text-sm">
            {[
              "In the assistant, add a custom connector and paste the connection URL.",
              "When it asks, sign in here and choose View only or View and propose.",
              "Ask away. You can change its access or disconnect it below at any time.",
            ].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-pine">{index + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Your connected assistants</h3>
            {connections.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-muted">No assistants connected yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {connections.map((connection) => (
                  <li key={connection.id} className="space-y-2 px-3 py-3">
                    <div>
                      <p className="font-semibold">{assistantName(connection)}</p>
                      <p className="text-xs text-muted">
                        Connected {connection.createdAt.toLocaleDateString()} · {connection.lastUsedAt ? `Last used ${when(connection.lastUsedAt).toLowerCase()}` : "Not used yet"}
                      </p>
                    </div>
                    <form action={updateOauthConnection} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={connection.id} />
                      <label className="sr-only" htmlFor={`access-${connection.id}`}>Access</label>
                      <select id={`access-${connection.id}`} name="access" className="field py-1.5 text-sm" style={{ width: "auto" }} defaultValue={connection.allowPropose ? "propose" : "view"}>
                        <option value="view">{ACCESS_LABELS.view}</option>
                        <option value="propose" disabled={!canPropose}>{ACCESS_LABELS.propose}</option>
                      </select>
                      <button className="btn" type="submit">Save</button>
                      <button className="btn-quiet ml-auto" type="submit" formAction={disconnectOauthConnection}>Disconnect</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="panel min-w-0 space-y-5 p-5" aria-labelledby="dev-heading">
          <div className="space-y-1">
            <h2 id="dev-heading" className="text-lg font-semibold">Developer tools</h2>
            <p className="text-sm text-muted">Claude Code, Cursor, the Grok CLI, and API calls use a personal token you create here.</p>
          </div>

          {shown ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-warn">Copy this token now. It is shown only once and is not stored. It is already filled in to the setup below.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input className="field flex-1 font-mono text-sm" readOnly value={shown} aria-label="New token" />
                <CopyButton value={shown} label="Copy token" />
              </div>
            </div>
          ) : null}

          <form action={createAccessToken} className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="label">Name</span>
              <input className="field" name="name" required placeholder="Claude Code on my laptop" />
            </label>
            <label>
              <span className="label">Access</span>
              <select className="field" name="access" defaultValue="view">
                <option value="view">{ACCESS_LABELS.view}</option>
                <option value="propose" disabled={!canPropose}>{ACCESS_LABELS.propose}</option>
              </select>
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
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <button className="btn" type="submit">Create token</button>
              {canPropose ? null : <span className="text-xs text-muted">View and propose needs edit access to AI access and to Dimension.</span>}
            </div>
          </form>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Setup</h3>
            <SetupTabs tabs={setupTabs(endpoint, shown ?? "edb_your_token")} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Your tokens</h3>
            {mine.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-muted">No tokens yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {mine.map((token) => (
                  <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                    <div>
                      <p className="font-semibold">{token.name}</p>
                      <p className="text-xs text-muted">
                        <span className="font-mono">{token.prefix}…</span> · {accessLabel(token.scopes.includes("propose"))} · {tokenState(token)} ·{" "}
                        {token.lastUsedAt ? `Last used ${when(token.lastUsedAt).toLowerCase()}` : "Not used yet"}
                      </p>
                    </div>
                    <form action={revokeAccessToken}>
                      <input type="hidden" name="id" value={token.id} />
                      <button className="btn-quiet" type="submit">Revoke</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {user.isAdmin ? (
        <details className="panel group" open={!anyEnabled}>
          <summary className="section-toggle flex cursor-pointer items-center gap-2 p-4 text-lg font-semibold text-pine">
            <span className="mark" aria-hidden="true" />
            Administration
            <span className="text-sm font-normal text-muted">· Which assistants can sign in, and everyone&apos;s connections</span>
          </summary>
          <div className="space-y-6 border-t border-line p-4">
            <div className="space-y-2">
              <h3 className="flex items-center text-sm font-semibold">
                Chat assistants allowed to sign in
                <HelpTip text="Each assistant is off until an administrator turns it on. Turning one off blocks new sign-ins and stops its existing connections at their next request. Tokens keep working." />
              </h3>
              <form action={saveOauthProducts} className="flex flex-wrap items-center gap-4 text-sm">
                <label className="inline-flex items-center gap-2"><input type="checkbox" name="chatgpt" defaultChecked={oauth.allowChatGpt} /> ChatGPT</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" name="claude" defaultChecked={oauth.allowClaude} /> Claude</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" name="grok" defaultChecked={oauth.allowGrok} /> Grok</label>
                <button className="btn" type="submit">Save</button>
              </form>
            </div>

            <div className="space-y-2">
              <h3 className="flex items-center text-sm font-semibold">
                All connections and tokens
                <HelpTip text="Disconnect or revoke anyone's access, for example when a laptop is lost or someone leaves." />
              </h3>
              {everyone.length === 0 ? (
                <p className="text-sm text-muted">Nobody has connected an assistant yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="px-3 py-2 font-semibold">Person</th>
                        <th className="px-3 py-2 font-semibold">Name</th>
                        <th className="px-3 py-2 font-semibold">Type</th>
                        <th className="px-3 py-2 font-semibold">Access</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold">Last used</th>
                        <th className="px-3 py-2"><span className="sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {everyone.map((row) => (
                        <tr key={row.key}>
                          <td className="px-3 py-2 font-semibold">{row.person}</td>
                          <td className="px-3 py-2">{row.name}</td>
                          <td className="px-3 py-2">{row.type}</td>
                          <td className="px-3 py-2">{row.access}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.status}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.lastUsed}</td>
                          <td className="px-3 py-2 text-right">
                            <form action={row.action === "disconnect" ? disconnectOauthConnection : revokeAccessToken}>
                              <input type="hidden" name="id" value={row.id} />
                              <button className="btn-quiet" type="submit">{row.action === "disconnect" ? "Disconnect" : "Revoke"}</button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
