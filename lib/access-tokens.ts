import { createHash, randomBytes } from "node:crypto";
import { loadAccess, type AccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/** Scopes a token can carry. Every token can read; "propose" also lets it submit changes for review. */
export const TOKEN_SCOPES = ["read", "propose"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

const PREFIX = "edb_";
const TOUCH_MS = 5 * 60_000;

export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A new token. Only its hash is stored; the token is shown to its owner once. */
export function newToken() {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, PREFIX.length + 6) };
}

export type TokenIdentity = { access: AccessContext; tokenId: string; scopes: string[]; userName: string };

/**
 * Resolves an Authorization header to a person. The token must be unrevoked and unexpired,
 * and its owner active; the owner's current grants decide what the assistant can see.
 */
export async function authenticateToken(header: string | null): Promise<TokenIdentity | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!match || !match[1].startsWith(PREFIX)) return null;
  const row = await prisma.accessToken.findUnique({
    where: { tokenHash: hashToken(match[1]) },
    include: { user: { include: { groups: { include: { group: true } } } } },
  });
  const now = Date.now();
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= now) || !row.user.isActive) return null;
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_MS) {
    await prisma.accessToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } }).catch(() => undefined);
  }
  return { access: await loadAccess(row.user), tokenId: row.id, scopes: row.scopes, userName: row.user.name };
}
