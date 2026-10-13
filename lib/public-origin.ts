/**
 * The address people and assistants use to reach the app, such as https://dimensions.example.com.
 *
 * APP_URL wins when it is set. Without it, the address comes from the request's headers: a reverse
 * proxy such as Caddy or nginx sends X-Forwarded-Host and X-Forwarded-Proto, and the Host header is
 * the fallback. request.url is not used, because behind a proxy Next.js reports its own listening
 * address there (http://localhost:3000), which an assistant or identity provider cannot reach.
 */
type HeaderSource = { get(name: string): string | null };

const HOST = /^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/i;

/** First value of a header a proxy chain may have appended to ("a, b"). */
function firstValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function configuredOrigin() {
  const configured = process.env.APP_URL?.trim();
  return configured ? new URL(configured).origin : null;
}

export function originFromHeaders(headerList: HeaderSource, fallback = "http://localhost:3000") {
  const configured = configuredOrigin();
  if (configured) return configured;
  const host = firstValue(headerList.get("x-forwarded-host")) ?? firstValue(headerList.get("host"));
  if (!host || !HOST.test(host)) return new URL(fallback).origin;
  const forwarded = firstValue(headerList.get("x-forwarded-proto"))?.toLowerCase();
  const proto = forwarded === "https" || forwarded === "http" ? forwarded : new URL(fallback).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** The public origin for a route handler's request. */
export function requestOrigin(request: Request) {
  return originFromHeaders(request.headers, request.url);
}
