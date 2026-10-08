/** Shared bucket when the connection address is missing or the forwarded header is not trusted. */
export const UNKNOWN_CLIENT = "unknown";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function trustProxy() {
  return /^(1|true|yes)$/i.test(process.env.TRUST_PROXY?.trim() ?? "");
}

function firstForwarded(headerStore: { get(name: string): string | null }) {
  const forwarded = headerStore.get("x-forwarded-for");
  if (!forwarded) return "";
  return forwarded.split(",")[0]?.trim().slice(0, 200) ?? "";
}

/**
 * Address used for rate limits.
 * X-Forwarded-For and X-Real-IP are honored only when TRUST_PROXY is set,
 * because a caller can otherwise send a new address on every attempt.
 * A direct local connection is recognized when the platform recorded a
 * loopback address. Every other request, including one with no address,
 * shares the unknown bucket so it still counts.
 */
export function clientAddress(headerStore: { get(name: string): string | null }) {
  const forwarded = firstForwarded(headerStore);
  if (trustProxy()) {
    if (forwarded) return forwarded;
    const real = headerStore.get("x-real-ip")?.trim().slice(0, 200) ?? "";
    return real || UNKNOWN_CLIENT;
  }
  if (LOOPBACK.has(forwarded)) return forwarded;
  return UNKNOWN_CLIENT;
}
