export async function register() {
  const { assertAuthSecret } = await import("@/lib/session-token");
  assertAuthSecret();
}
