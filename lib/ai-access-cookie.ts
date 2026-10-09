import { cookies } from "next/headers";

/** Holds a new AI access token for two minutes so the page can show it once. */
export const NEW_TOKEN_COOKIE = "new_ai_token";

export async function readNewAccessToken() {
  const raw = (await cookies()).get(NEW_TOKEN_COOKIE)?.value;
  if (!raw) return null;
  const split = raw.indexOf(":");
  if (split < 1) return null;
  return { tokenId: raw.slice(0, split), token: raw.slice(split + 1) };
}
