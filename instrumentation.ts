export async function register() {
  // The app and its proxy run on Node.js; nothing here applies to the Edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertAuthSecret } = await import("@/lib/session-token");
  assertAuthSecret();
  if (process.env.NODE_ENV === "production" && !/^(1|true|yes)$/i.test(process.env.TRUST_PROXY?.trim() ?? "")) {
    console.warn(
      "TRUST_PROXY is not set. Every remote caller shares one address bucket, so per-address sign-in and API throttling is off. " +
        "Set TRUST_PROXY=true when a reverse proxy sets X-Forwarded-For to the real client address.",
    );
  }
  if (process.env.NODE_ENV === "production" && !process.env.APP_URL?.trim()) {
    console.warn(
      "APP_URL is not set. The public address for AI assistant sign-in and single sign-on is taken from each request's " +
        "X-Forwarded-Host or Host header. Set APP_URL to the address people use, such as https://dimensions.example.com.",
    );
  }
  // Overdue alerts and housekeeping run inside the app. Set SCHEDULER=off to rely on an outside scheduler.
  await import("@/lib/jobs");
}
