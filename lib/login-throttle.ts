import { prisma } from "@/lib/prisma";
import { UNKNOWN_CLIENT } from "@/lib/client-address";

/**
 * Sign-in throttling, designed so that nobody can lock a person out.
 *
 * - account: after 5 failures for one email, each further attempt must wait a little
 *   longer (30 seconds, doubling, at most 5 minutes). Guessing slows to a crawl, but the
 *   real owner is only ever delayed for minutes, never locked out for an hour.
 * - pair: 5 failures for one email from one address blocks that address for that email
 *   for 15 minutes.
 * - client: 30 failures from one address across any emails blocks the address for an
 *   hour (password spraying).
 *
 * The pair and client rules apply only when the address is known. Without TRUST_PROXY,
 * remote callers share one "unknown" address, and blocking it would block everyone.
 * Counters reset after an hour without failures.
 */
const RESET_AFTER_MS = 60 * 60 * 1000;

type Rule = { limit: number; blockMs: (failures: number) => number };

const ACCOUNT: Rule = {
  limit: 5,
  blockMs: (failures) => Math.min(30_000 * 2 ** (failures - 6), 5 * 60_000),
};
const PAIR: Rule = { limit: 5, blockMs: () => 15 * 60_000 };
const CLIENT: Rule = { limit: 30, blockMs: () => 60 * 60_000 };

function keys(email: string, address: string) {
  const known = address !== UNKNOWN_CLIENT;
  return [
    { key: `account:${email}`, rule: ACCOUNT },
    ...(known ? [{ key: `pair:${email}|${address}`, rule: PAIR }, { key: `client:${address}`, rule: CLIENT }] : []),
  ];
}

/** Pure decision used by noteFailure; exported for tests. */
export function nextFailureState(
  existing: { failureCount: number; updatedAt: Date } | null,
  rule: Rule,
  now: number,
) {
  const stale = !existing || now - existing.updatedAt.getTime() > RESET_AFTER_MS;
  const failureCount = stale ? 1 : existing.failureCount + 1;
  const blockedUntil = failureCount > rule.limit ? new Date(now + rule.blockMs(failureCount)) : null;
  return { failureCount, blockedUntil };
}

export const THROTTLE_RULES = { ACCOUNT, PAIR, CLIENT };

/** When sign-in is blocked, the time it opens again; otherwise null. */
export async function loginBlockedUntil(email: string, address: string): Promise<Date | null> {
  const rows = await prisma.loginLock.findMany({ where: { key: { in: keys(email, address).map((item) => item.key) } } });
  const now = Date.now();
  const until = rows
    .map((row) => row.blockedUntil?.getTime() ?? 0)
    .filter((time) => time > now)
    .sort((left, right) => right - left)[0];
  return until ? new Date(until) : null;
}

export async function noteLoginFailure(email: string, address: string): Promise<Date | null> {
  const now = Date.now();
  let latest: Date | null = null;
  for (const { key, rule } of keys(email, address)) {
    const existing = await prisma.loginLock.findUnique({ where: { key } });
    const next = nextFailureState(existing, rule, now);
    await prisma.loginLock.upsert({
      where: { key },
      create: { key, ...next },
      update: next,
    });
    if (next.blockedUntil && (!latest || next.blockedUntil > latest)) latest = next.blockedUntil;
  }
  return latest;
}

/** A correct password clears the account and pair counters. The client counter is kept. */
export async function clearLoginFailures(email: string, address: string) {
  const cleared = keys(email, address).filter((item) => item.rule !== CLIENT).map((item) => item.key);
  await prisma.loginLock.deleteMany({ where: { key: { in: cleared } } });
}
