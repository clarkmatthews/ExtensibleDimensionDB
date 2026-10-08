import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dimension_session";

const MIN_SECRET_LENGTH = 32;
const KNOWN_SECRET_HASHES = new Set([
  "759ded9b291803c40d3c70616688f0eb262e9c6ed43672e928097040a1ea6104",
]);
const KNOWN_SECRETS = new Set(["replace-with-a-long-random-string"]);

type SessionPayload = { userId: string; exp: number };

export function assertAuthSecret() {
  secret();
}

function secret() {
  const value = process.env.AUTH_SECRET?.trim() ?? "";
  const digest = createHash("sha256").update(value).digest("hex");
  if (value.length < MIN_SECRET_LENGTH || KNOWN_SECRETS.has(value) || KNOWN_SECRET_HASHES.has(digest)) {
    throw new Error("AUTH_SECRET must be a unique random string of at least 32 characters.");
  }
  return value;
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function createSessionToken(userId: string) {
  const body = Buffer.from(
    JSON.stringify({ userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 12 } satisfies SessionPayload),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (!payload.userId || payload.exp < Date.now()) return null;
    return payload.userId;
  } catch {
    return null;
  }
}
