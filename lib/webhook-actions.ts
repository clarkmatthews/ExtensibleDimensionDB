"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audited } from "@/lib/audit";
import { decryptSecret } from "@/lib/mail";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { NEW_WEBHOOK_SECRET_COOKIE } from "@/lib/webhook-secret";
import { newWebhookSecret, sendWebhook, WEBHOOK_EVENTS, webhookUrlError } from "@/lib/webhooks";

const PAGE = "/admin/webhooks";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function back(query: string): never {
  redirect(`${PAGE}?${query}`);
}

async function editor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canEditModule(access, "WEBHOOKS")) back(`error=${encodeURIComponent("You cannot change webhooks.")}`);
  return user;
}

async function rememberSecret(endpointId: string, secret: string) {
  (await cookies()).set(NEW_WEBHOOK_SECRET_COOKIE, `${endpointId}:${secret}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: PAGE,
    maxAge: 120,
  });
}

export async function saveWebhook(formData: FormData) {
  return audited("webhooks.save", [formData], async () => {
    await editor();
    const id = text(formData, "id");
    const name = text(formData, "name");
    const url = text(formData, "url");
    const allowed = new Set<string>(WEBHOOK_EVENTS.map((event) => event.id));
    const events = formData.getAll("event").map(String).filter((event) => allowed.has(event));
    const categoryIds = formData.getAll("categoryId").map(String).filter(Boolean);
    if (!name) back(`error=${encodeURIComponent("Enter a name.")}`);
    if (!events.length) back(`error=${encodeURIComponent("Choose at least one event.")}`);
    const urlError = await webhookUrlError(url);
    if (urlError) back(`error=${encodeURIComponent(urlError)}`);
    if (id) {
      await prisma.webhookEndpoint.update({ where: { id }, data: { name, url, events, categoryIds } });
    } else {
      const issued = newWebhookSecret();
      const created = await prisma.webhookEndpoint.create({
        data: { name, url, events, categoryIds, secret: issued.stored, secretHint: issued.hint },
      });
      await rememberSecret(created.id, issued.secret);
    }
    revalidatePath(PAGE);
    back("saved=1");
  });
}

export async function setWebhookActive(formData: FormData) {
  return audited("webhooks.setActive", [formData], async () => {
    await editor();
    await prisma.webhookEndpoint.update({ where: { id: text(formData, "id") }, data: { isActive: text(formData, "active") === "1" } });
    revalidatePath(PAGE);
    back("saved=1");
  });
}

export async function regenerateWebhookSecret(formData: FormData) {
  return audited("webhooks.regenerateSecret", [formData], async () => {
    await editor();
    const id = text(formData, "id");
    const issued = newWebhookSecret();
    await prisma.webhookEndpoint.update({ where: { id }, data: { secret: issued.stored, secretHint: issued.hint } });
    await rememberSecret(id, issued.secret);
    revalidatePath(PAGE);
    back("saved=secret");
  });
}

export async function deleteWebhook(formData: FormData) {
  return audited("webhooks.delete", [formData], async () => {
    await editor();
    await prisma.webhookEndpoint.delete({ where: { id: text(formData, "id") } });
    revalidatePath(PAGE);
    back("saved=deleted");
  });
}

/** Sends a signed test event right away and reports what the receiver answered. */
export async function sendTestWebhook(formData: FormData) {
  return audited("webhooks.test", [formData], async () => {
    const user = await editor();
    const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: text(formData, "id") } });
    if (!endpoint) back(`error=${encodeURIComponent("That webhook no longer exists.")}`);
    let secret = "";
    try {
      secret = decryptSecret(endpoint.secret);
    } catch {
      back(`error=${encodeURIComponent("The signing secret could not be read. Regenerate it.")}`);
    }
    const outcome = await sendWebhook(endpoint.url, secret, `test_${Date.now()}`, "webhook.test", {
      event: "webhook.test",
      occurredAt: new Date().toISOString(),
      actor: { name: user.name },
    });
    back(outcome.ok ? `tested=${outcome.status}` : `error=${encodeURIComponent(`Test failed: ${outcome.error}`)}`);
  });
}

/** Puts a failed delivery back in the queue with a fresh set of retries. */
export async function retryDelivery(formData: FormData) {
  return audited("webhooks.retry", [formData], async () => {
    await editor();
    await prisma.webhookDelivery.update({
      where: { id: text(formData, "id") },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: "" },
    });
    revalidatePath(PAGE);
    back("saved=retry");
  });
}
