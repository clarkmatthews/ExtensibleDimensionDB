import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { Prisma } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import type { SavedChange } from "@/lib/workflow";

/**
 * Outbound webhooks. Events are queued in WebhookDelivery inside the app's database, then
 * a background job delivers them with retries. Each request is signed with the endpoint's
 * secret so the receiver can check it came from this app and was not altered.
 */

export const WEBHOOK_EVENTS = [
  { id: "record.created", label: "Record created" },
  { id: "record.updated", label: "Record updated" },
  { id: "record.archived", label: "Record archived" },
  { id: "record.restored", label: "Record restored" },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["id"];

/** Delay before each retry, in minutes. After the last one the delivery is marked failed. */
export const RETRY_MINUTES = [1, 5, 15, 60, 180, 360, 720, 1440];

const TIMEOUT_MS = 10_000;
const BATCH = 50;

export function newWebhookSecret() {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  return { secret, stored: encryptSecret(secret), hint: secret.slice(-4) };
}

/**
 * Signature header in the form "t=<unix seconds>,v1=<hex>", where v1 is the HMAC-SHA256 of
 * "<t>.<raw body>" with the endpoint secret. Receivers recompute it and reject old timestamps.
 */
export function signPayload(secret: string, body: string, timestamp: number) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

// Addresses a webhook may not reach unless WEBHOOK_ALLOW_PRIVATE is set: loopback, private
// networks, link-local (including cloud metadata at 169.254.169.254), and similar.
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

function allowPrivate() {
  return /^(1|true|yes)$/i.test(process.env.WEBHOOK_ALLOW_PRIVATE?.trim() ?? "");
}

export function isBlockedAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return true;
}

/** Returns an error message when a URL may not be used for webhooks. */
export async function webhookUrlError(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, starting with https://.";
  }
  if (url.username || url.password) return "Do not put a user name or password in the URL. Use the signing secret instead.";
  const privateOk = allowPrivate();
  if (url.protocol !== "https:" && !(privateOk && url.protocol === "http:")) return "Webhook URLs must use https://.";
  if (privateOk) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    return "That host name could not be found.";
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) {
    return "Webhooks cannot reach private, local, or internal network addresses.";
  }
  return null;
}

type RecordEvent = {
  event: WebhookEvent;
  locationId: string;
  actorName: string;
  changes?: SavedChange[];
};

/** Queues one event for every active endpoint that wants it. Never throws. */
export async function enqueueRecordEvent(input: RecordEvent) {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({ where: { isActive: true, events: { has: input.event } } });
    if (!endpoints.length) return;
    const changed = input.changes ?? [];
    const fieldIds = [...new Set(changed.map((change) => change.fieldId))];
    const [fields, label] = await Promise.all([
      fieldIds.length
        ? prisma.fieldDefinition.findMany({ where: { id: { in: fieldIds } }, include: { category: true } })
        : Promise.resolve([]),
      prisma.fieldValue.findFirst({
        where: { locationId: input.locationId, field: { isStoreKey: true } },
        include: { field: { select: { categoryId: true } } },
      }),
    ]);
    const byId = new Map(fields.map((field) => [field.id, field]));
    const occurredAt = new Date().toISOString();
    const rows: Prisma.WebhookDeliveryCreateManyInput[] = [];
    for (const endpoint of endpoints) {
      const inScope = (categoryId: string) => endpoint.categoryIds.length === 0 || endpoint.categoryIds.includes(categoryId);
      const changes = changed
        .filter((change) => inScope(change.categoryId))
        .map((change) => {
          const field = byId.get(change.fieldId);
          return {
            attribute: field?.key ?? change.fieldId,
            name: change.attribute,
            dimension: field?.category.name ?? "",
            previous: change.oldValue,
            value: change.newValue,
          };
        });
      // An update that touched nothing this endpoint can see is not sent.
      if (input.event === "record.updated" && changes.length === 0) continue;
      const showLabel = label?.valueText && inScope(label.field.categoryId);
      rows.push({
        endpointId: endpoint.id,
        event: input.event,
        payload: {
          event: input.event,
          occurredAt,
          record: { id: input.locationId, label: showLabel ? label.valueText : null },
          actor: { name: input.actorName },
          changes,
        },
      });
    }
    if (rows.length) await prisma.webhookDelivery.createMany({ data: rows });
  } catch (error) {
    console.error("Could not queue webhook event", input.event, error);
  }
}

export type DeliveryOutcome = { ok: boolean; status: number | null; error: string };

/** Sends one request. Redirects are not followed, so a webhook cannot be bounced elsewhere. */
export async function sendWebhook(url: string, secret: string, deliveryId: string, event: string, payload: unknown): Promise<DeliveryOutcome> {
  const urlError = await webhookUrlError(url);
  if (urlError) return { ok: false, status: null, error: urlError };
  const body = JSON.stringify({ id: deliveryId, ...(payload as object) });
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ExtensibleDimensionDB-Webhooks/1",
        "X-Dimension-Event": event,
        "X-Dimension-Delivery": deliveryId,
        "X-Dimension-Signature": signPayload(secret, body, timestamp),
      },
      body,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) return { ok: true, status: response.status, error: "" };
    return { ok: false, status: response.status, error: `The receiver answered ${response.status}.` };
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "No answer within 10 seconds." : "Could not connect.";
    return { ok: false, status: null, error: message };
  }
}

/** Next state for a delivery after an attempt. Exported for tests. */
export function afterAttempt(attempts: number, outcome: DeliveryOutcome, now: number) {
  if (outcome.ok) return { status: "DELIVERED", attempts, nextAttemptAt: new Date(now), deliveredAt: new Date(now) };
  const delay = RETRY_MINUTES[attempts - 1];
  if (delay === undefined) return { status: "FAILED", attempts, nextAttemptAt: new Date(now), deliveredAt: null };
  return { status: "PENDING", attempts, nextAttemptAt: new Date(now + delay * 60_000), deliveredAt: null };
}

/** Delivers queued events that are due. Runs from the scheduler, one server at a time. */
export async function deliverDueWebhooks() {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() }, endpoint: { isActive: true } },
    include: { endpoint: true },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH,
  });
  let delivered = 0;
  for (const delivery of due) {
    let secret = "";
    try {
      secret = decryptSecret(delivery.endpoint.secret);
    } catch {
      secret = "";
    }
    const outcome = secret
      ? await sendWebhook(delivery.endpoint.url, secret, delivery.id, delivery.event, delivery.payload)
      : { ok: false, status: null, error: "The signing secret could not be read. Regenerate it." };
    const attempts = delivery.attempts + 1;
    const next = afterAttempt(attempts, outcome, Date.now());
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { ...next, lastStatus: outcome.status, lastError: outcome.error.slice(0, 300) },
    });
    if (outcome.ok) delivered += 1;
  }
  return `${delivered} of ${due.length} delivered`;
}
