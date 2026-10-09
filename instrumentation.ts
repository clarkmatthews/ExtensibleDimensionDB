export async function register() {
  const { assertAuthSecret } = await import("@/lib/session-token");
  assertAuthSecret();
  if (process.env.NODE_ENV === "production" && !/^(1|true|yes)$/i.test(process.env.TRUST_PROXY?.trim() ?? "")) {
    console.warn(
      "TRUST_PROXY is not set. Every remote caller shares one address bucket, so per-address sign-in and API throttling is off. " +
        "Set TRUST_PROXY=true when a reverse proxy sets X-Forwarded-For to the real client address.",
    );
  }
}
