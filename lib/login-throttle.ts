import { prisma } from "@/lib/prisma";

const FAILURE_LIMIT = 5;
const BLOCK_MS = 60 * 60 * 1000;

function emailKey(email: string) {
  return `email:${email}`;
}

function clientKey(address: string) {
  return `client:${address}`;
}

async function blocked(key: string) {
  const row = await prisma.loginLock.findUnique({ where: { key } });
  return Boolean(row?.blockedUntil && row.blockedUntil.getTime() > Date.now());
}

async function noteFailure(key: string) {
  const now = new Date();
  const existing = await prisma.loginLock.findUnique({ where: { key } });
  const blockExpired = Boolean(existing?.blockedUntil && existing.blockedUntil.getTime() <= now.getTime());
  const count = !existing || blockExpired ? 1 : existing.failureCount + 1;
  const locked = count > FAILURE_LIMIT;
  await prisma.loginLock.upsert({
    where: { key },
    create: {
      key,
      failureCount: count,
      blockedUntil: locked ? new Date(now.getTime() + BLOCK_MS) : null,
    },
    update: {
      failureCount: count,
      blockedUntil: locked ? new Date(now.getTime() + BLOCK_MS) : null,
    },
  });
  return locked;
}

export async function loginBlocked(email: string, address: string) {
  return (await blocked(emailKey(email))) || (await blocked(clientKey(address)));
}

export async function noteLoginFailure(email: string, address: string) {
  const emailLocked = await noteFailure(emailKey(email));
  const clientLocked = await noteFailure(clientKey(address));
  return emailLocked || clientLocked;
}

export async function clearLoginFailures(email: string, address: string) {
  await prisma.loginLock.deleteMany({ where: { key: { in: [emailKey(email), clientKey(address)] } } });
}
