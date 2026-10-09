import type { Prisma } from "@prisma/client";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

/** Form fields that are never written to the audit log, by name. */
const SENSITIVE = /pass(word)?|secret|token|smtp_?pass/i;
const MAX_VALUE = 500;
const MAX_ENTRIES = 200;

type Detail = Record<string, Prisma.InputJsonValue>;

function clip(value: string) {
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
}

/** Turns action arguments into a JSON detail, dropping anything that looks like a credential. */
export function auditDetail(args: unknown[]): Detail {
  const detail: Detail = {};
  args.forEach((arg, index) => {
    if (arg instanceof FormData) {
      const fields: Record<string, string | string[]> = {};
      let count = 0;
      for (const [name, value] of arg.entries()) {
        if (name.startsWith("$ACTION")) continue;
        if (++count > MAX_ENTRIES) break;
        const text = SENSITIVE.test(name)
          ? (String(value) ? "[changed]" : "")
          : clip(typeof value === "string" ? value : `[file ${value.name}]`);
        if (SENSITIVE.test(name) && !text) continue;
        const existing = fields[name];
        if (existing === undefined) fields[name] = text;
        else fields[name] = Array.isArray(existing) ? [...existing, text] : [existing, text];
      }
      detail.form = fields;
    } else if (typeof arg === "string") {
      detail[`arg${index}`] = clip(arg);
    } else if (typeof arg === "number" || typeof arg === "boolean") {
      detail[`arg${index}`] = arg;
    } else if (Array.isArray(arg)) {
      detail[`arg${index}`] = arg.slice(0, MAX_ENTRIES).map((item) => clip(String(item)));
    }
  });
  return detail;
}

/** True when an action's result says it was refused. Refused attempts are not changes. */
function failed(result: unknown) {
  return Boolean(result && typeof result === "object" && "error" in result && (result as { error: unknown }).error);
}

function redirectFailed(error: unknown) {
  if (!isRedirectError(error)) return false;
  const url = getURLFromRedirectError(error);
  return /[?&]error=/.test(url) || url.startsWith("/login");
}

export async function writeAudit(action: string, detail: Detail, userId?: string | null) {
  try {
    const actorId = userId === undefined ? ((await getCurrentUser())?.id ?? null) : userId;
    await prisma.auditLog.create({ data: { action, detail, userId: actorId } });
  } catch (error) {
    console.error("Could not write the audit log entry", action, error);
  }
}

/**
 * Runs an administrative action and records it when it succeeds.
 * Success is a normal return without an error, or a redirect that does not carry ?error=.
 */
export async function audited<T>(action: string, args: unknown[], run: () => Promise<T>): Promise<T> {
  const userId = (await getCurrentUser())?.id ?? null;
  const detail = auditDetail(args);
  try {
    const result = await run();
    if (!failed(result)) await writeAudit(action, detail, userId);
    return result;
  } catch (error) {
    if (isRedirectError(error) && !redirectFailed(error)) await writeAudit(action, detail, userId);
    throw error;
  }
}
