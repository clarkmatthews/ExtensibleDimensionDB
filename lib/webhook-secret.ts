import { cookies } from "next/headers";

/** Holds a new signing secret for two minutes so the Webhooks page can show it once. */
export const NEW_WEBHOOK_SECRET_COOKIE = "new_webhook_secret";

export async function readNewWebhookSecret() {
  const raw = (await cookies()).get(NEW_WEBHOOK_SECRET_COOKIE)?.value;
  if (!raw) return null;
  const split = raw.indexOf(":");
  if (split < 1) return null;
  return { endpointId: raw.slice(0, split), secret: raw.slice(split + 1) };
}
