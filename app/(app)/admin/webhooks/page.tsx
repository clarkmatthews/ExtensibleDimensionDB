import { redirect } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import {
  deleteWebhook,
  regenerateWebhookSecret,
  retryDelivery,
  saveWebhook,
  sendTestWebhook,
  setWebhookActive,
} from "@/lib/webhook-actions";
import { readNewWebhookSecret } from "@/lib/webhook-secret";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

export const metadata = { title: "Webhooks" };

const SAVED: Record<string, string> = {
  "1": "Webhook saved.",
  secret: "Signing secret regenerated. Copy it below and update the receiver. It is shown only once.",
  deleted: "Webhook deleted.",
  retry: "Delivery queued again.",
};

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; tested?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "WEBHOOKS")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "WEBHOOKS");
  const params = await searchParams;
  const fresh = canEdit ? await readNewWebhookSecret() : null;
  const [categories, endpoints] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.webhookEndpoint.findMany({
      orderBy: { name: "asc" },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 25 } },
    }),
  ]);
  const saved = params.tested ? `Test delivered. The receiver answered ${params.tested}.` : SAVED[params.saved ?? ""] ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Webhooks
          <HelpTip text="Send a signed JSON message to another system when records are created, updated, archived, or restored. Deliveries are retried for about a day when the receiver is down." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Each request is a POST with an <span className="font-mono">X-Dimension-Signature</span> header:{" "}
          <span className="font-mono">t=&lt;unix time&gt;,v1=&lt;HMAC-SHA256 of &quot;t.body&quot; with the signing secret&gt;</span>.
          Receivers should check it and reject timestamps older than five minutes.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {saved ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">{saved}</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view webhooks. Edit access is required to change them.</p> : null}

      {canEdit ? (
        <section className="panel p-4">
          <details>
            <summary className="section-toggle flex cursor-pointer items-center gap-2 font-semibold">
              <span className="mark" aria-hidden="true" />
              New webhook
            </summary>
            <div className="mt-4">
              <WebhookForm categories={categories} />
            </div>
          </details>
        </section>
      ) : null}

      {endpoints.length === 0 ? <p className="text-sm text-muted">No webhooks yet.</p> : null}
      {endpoints.map((endpoint) => {
        const showSecret = fresh?.endpointId === endpoint.id;
        const failed = endpoint.deliveries.filter((delivery) => delivery.status === "FAILED").length;
        return (
          <section key={endpoint.id} className="panel p-4">
            <details open={showSecret}>
              <summary className="section-toggle flex cursor-pointer flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span className="mark" aria-hidden="true" />
                  <span className={endpoint.isActive ? "text-lg font-semibold" : "text-lg font-semibold text-muted line-through"}>{endpoint.name}</span>
                </span>
                <span className="text-sm text-muted">
                  {endpoint.isActive ? "Enabled" : "Disabled"} · {endpoint.events.length} events
                  {failed ? ` · ${failed} failed` : ""}
                </span>
              </summary>
              <div className="mt-4 space-y-4">
                <p className="break-all font-mono text-sm">{endpoint.url}</p>
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <label>
                    <span className="label">Signing secret</span>
                    <input
                      className={showSecret ? "field font-mono" : "field font-mono text-muted"}
                      readOnly
                      value={showSecret ? fresh.secret : `Ends in ${endpoint.secretHint || "…"}`}
                    />
                  </label>
                  {showSecret ? <span className="self-end"><CopyButton value={fresh.secret} label="Copy secret" /></span> : <span />}
                </div>
                {showSecret ? (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-warn">
                    Copy this secret now. It is shown only once. If it is lost, regenerate it.
                  </p>
                ) : null}
                {canEdit ? (
                  <>
                    <WebhookForm categories={categories} endpoint={endpoint} />
                    <div className="flex flex-wrap gap-2">
                      <form action={sendTestWebhook}>
                        <input type="hidden" name="id" value={endpoint.id} />
                        <button className="btn-quiet" type="submit">Send test</button>
                      </form>
                      <form action={setWebhookActive}>
                        <input type="hidden" name="id" value={endpoint.id} />
                        <input type="hidden" name="active" value={endpoint.isActive ? "0" : "1"} />
                        <button className="btn-quiet" type="submit">{endpoint.isActive ? "Disable" : "Enable"}</button>
                      </form>
                      <form action={regenerateWebhookSecret}>
                        <input type="hidden" name="id" value={endpoint.id} />
                        <button className="btn-quiet" type="submit">Regenerate secret</button>
                      </form>
                      <form action={deleteWebhook}>
                        <input type="hidden" name="id" value={endpoint.id} />
                        <button className="btn-quiet text-danger" type="submit">Delete</button>
                      </form>
                    </div>
                  </>
                ) : null}
                <div>
                  <h3 className="flex items-center text-sm font-semibold">
                    Recent deliveries
                    <HelpTip text="The latest 25 events for this webhook. Pending deliveries are retried after 1, 5, and 15 minutes, then 1, 3, 6, 12, and 24 hours. After that they are marked failed and can be retried by hand." />
                  </h3>
                  {endpoint.deliveries.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing sent yet.</p> : (
                    <div className="mt-2 overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-left">
                          <tr>
                            <th className="px-2 py-1 font-semibold">Time</th>
                            <th className="px-2 py-1 font-semibold">Event</th>
                            <th className="px-2 py-1 font-semibold">Status</th>
                            <th className="px-2 py-1 font-semibold">Attempts</th>
                            <th className="px-2 py-1 font-semibold">Last result</th>
                            <th className="px-2 py-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {endpoint.deliveries.map((delivery) => (
                            <tr key={delivery.id} className="border-t border-line">
                              <td className="whitespace-nowrap px-2 py-1">{delivery.createdAt.toLocaleString()}</td>
                              <td className="px-2 py-1 font-mono">{delivery.event}</td>
                              <td className="px-2 py-1">
                                {delivery.status === "PENDING" && delivery.attempts > 0
                                  ? `Retrying ${delivery.nextAttemptAt.toLocaleTimeString()}`
                                  : delivery.status.charAt(0) + delivery.status.slice(1).toLowerCase()}
                              </td>
                              <td className="px-2 py-1">{delivery.attempts}</td>
                              <td className="px-2 py-1">{delivery.lastError || (delivery.lastStatus ? String(delivery.lastStatus) : "")}</td>
                              <td className="px-2 py-1">
                                {canEdit && delivery.status === "FAILED" ? (
                                  <form action={retryDelivery}>
                                    <input type="hidden" name="id" value={delivery.id} />
                                    <button className="btn-quiet" type="submit">Retry</button>
                                  </form>
                                ) : null}
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
          </section>
        );
      })}
    </div>
  );
}

function WebhookForm({
  categories,
  endpoint,
}: {
  categories: { id: string; name: string }[];
  endpoint?: { id: string; name: string; url: string; events: string[]; categoryIds: string[] };
}) {
  return (
    <form action={saveWebhook} className="space-y-3">
      {endpoint ? <input type="hidden" name="id" value={endpoint.id} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <span className="label">Name</span>
          <input className="field" name="name" required defaultValue={endpoint?.name ?? ""} />
        </label>
        <label>
          <span className="label">URL</span>
          <input className="field font-mono" name="url" type="url" required placeholder="https://" defaultValue={endpoint?.url ?? ""} />
        </label>
      </div>
      <fieldset>
        <legend className="label">Events</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event.id} className="inline-flex items-center gap-2">
              <input type="checkbox" name="event" value={event.id} defaultChecked={endpoint ? endpoint.events.includes(event.id) : true} />
              {event.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label flex items-center">
          Dimensions
          <HelpTip text="Only changes to attributes in these dimensions are sent. Leave all unchecked to send every dimension. Updates that change nothing in these dimensions are not sent." />
        </legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {categories.map((category) => (
            <label key={category.id} className="inline-flex items-center gap-2">
              <input type="checkbox" name="categoryId" value={category.id} defaultChecked={endpoint?.categoryIds.includes(category.id) ?? false} />
              {category.name}
            </label>
          ))}
        </div>
      </fieldset>
      <button className="btn" type="submit">{endpoint ? "Save webhook" : "Create webhook"}</button>
    </form>
  );
}
