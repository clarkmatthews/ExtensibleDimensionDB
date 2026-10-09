import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { clientAddress, UNKNOWN_CLIENT } from "@/lib/client-address";
import { prisma } from "@/lib/prisma";
import { withLinkOptions } from "@/lib/record-types";
import { storedToDisplay, type DefinedField } from "@/lib/values";

/** Holds a newly issued secret for two minutes so API Config can show it once. */
export const NEW_SECRET_COOKIE = "new_share_secret";

export type ShareChoice = { label: string; value: string };

export type ShareField = {
  key: string;
  name: string;
  description: string;
  category: string;
  dataType: string;
  required: boolean;
  uniqueIdentifier: boolean;
  formatExample: string;
  validationPattern: string;
  recordType: string;
  choices?: ShareChoice[];
  linksTo?: string;
};

export type SharePayload = {
  fields: ShareField[];
  dimensions: { id: string; recordType: string; values: Record<string, string> }[];
};

export function bearerSecret(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function sourceIp(request: NextRequest) {
  return clientAddress(request.headers);
}

/** SHA-256 hex of a share secret. Secrets are 32 random bytes, so a fast hash is enough. */
export function hashShareSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Compares a presented secret with the stored hash in constant time. */
export function secretMatchesHash(provided: string, expectedHash: string) {
  if (!provided || !expectedHash) return false;
  const left = Buffer.from(hashShareSecret(provided), "hex");
  const right = Buffer.from(expectedHash, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function dateKey(value: Date | null | undefined) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

export function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function outsideDateRange(validFrom: Date | null, validTo: Date | null, today = todayKey()) {
  const from = dateKey(validFrom);
  const to = dateKey(validTo);
  if (from && today < from) return true;
  if (to && today > to) return true;
  return false;
}

export async function fieldsForEndpoint(endpointId: string) {
  const [scopes, picked, definitions] = await Promise.all([
    prisma.apiEndpointCategory.findMany({ where: { endpointId } }),
    prisma.apiEndpointField.findMany({ where: { endpointId } }),
    prisma.fieldDefinition.findMany({
      where: { category: { isActive: true } },
      include: { options: { orderBy: { sortOrder: "asc" } }, category: { include: { recordType: true } }, linkType: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
  ]);
  const pickedIds = new Set(picked.map((row) => row.fieldId));
  const wholeCategories = new Set(scopes.filter((row) => !row.applyToFields).map((row) => row.categoryId));
  const specificCategories = new Set(scopes.filter((row) => row.applyToFields).map((row) => row.categoryId));
  return withLinkOptions(
    definitions.filter((field) => {
      if (wholeCategories.has(field.categoryId)) return field.isActive;
      return specificCategories.has(field.categoryId) && pickedIds.has(field.id);
    }),
  );
}

export function shareField(
  field: DefinedField & { category: { name: string; recordType: { name: string } }; linkType?: { name: string } | null },
): ShareField {
  const result: ShareField = {
    key: field.key,
    name: field.friendlyName,
    description: field.description,
    category: field.category.name,
    dataType: field.dataType,
    required: field.isRequired,
    uniqueIdentifier: field.isStoreKey,
    formatExample: field.formatExample,
    validationPattern: field.validationPattern,
    recordType: field.category.recordType.name,
  };
  if (field.dataType === "RECORD_LINK") {
    // Values are the linked records' labels; the full list of possible records is not published.
    if (field.linkType) result.linksTo = field.linkType.name;
  } else if (field.options.length) {
    result.choices = field.options.map((option) => ({ label: option.label, value: option.value }));
  }
  return result;
}

export async function buildShare(endpointId: string): Promise<SharePayload> {
  const fields = await fieldsForEndpoint(endpointId);
  // Only records of the types the shared attributes belong to.
  const typeIds = [...new Set(fields.map((field) => field.category.recordTypeId))];
  const activeFields = await prisma.fieldDefinition.findMany({
    where: { isActiveFilter: true, dataType: "CHECKBOX", category: { recordTypeId: { in: typeIds } } },
    select: { id: true, category: { select: { recordTypeId: true } } },
  });
  // Each record type has its own optional "active" checkbox; records of a type without one are all shared.
  const activeByType = new Map(activeFields.map((field) => [field.category.recordTypeId, field.id]));
  const locations = typeIds.length
    ? await prisma.location.findMany({
        where: { isActive: true, recordTypeId: { in: typeIds } },
        include: { values: true, recordType: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const openLocations = locations.filter((location) => {
    const activeId = activeByType.get(location.recordTypeId);
    return !activeId || location.values.some((value) => value.fieldId === activeId && value.valueBoolean === true);
  });
  return {
    fields: fields.map(shareField),
    dimensions: openLocations.map((location) => ({
      id: location.id,
      recordType: location.recordType.name,
      values: Object.fromEntries(
        fields.filter((field) => field.category.recordTypeId === location.recordTypeId).map((field) => {
          const stored = location.values.find((value) => value.fieldId === field.id);
          return [field.key, storedToDisplay(field, stored)];
        }),
      ),
    })),
  };
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function shareToXml(payload: SharePayload) {
  const fields = payload.fields
    .map((field) => {
      const choices = (field.choices ?? [])
        .map((choice) => `        <choice label="${xmlEscape(choice.label)}" value="${xmlEscape(choice.value)}" />`)
        .join("\n");
      return [
        `    <field key="${xmlEscape(field.key)}" name="${xmlEscape(field.name)}" category="${xmlEscape(field.category)}" recordType="${xmlEscape(field.recordType)}" dataType="${xmlEscape(field.dataType)}" required="${field.required}" uniqueIdentifier="${field.uniqueIdentifier}"${field.linksTo ? ` linksTo="${xmlEscape(field.linksTo)}"` : ""}>`,
        `      <description>${xmlEscape(field.description)}</description>`,
        `      <formatExample>${xmlEscape(field.formatExample)}</formatExample>`,
        `      <validationPattern>${xmlEscape(field.validationPattern)}</validationPattern>`,
        choices ? `      <choices>\n${choices}\n      </choices>` : "      <choices />",
        "    </field>",
      ].join("\n");
    })
    .join("\n");
  const dimensions = payload.dimensions
    .map((dimension) => {
      const values = Object.entries(dimension.values)
        .map(([key, value]) => `      <value key="${xmlEscape(key)}">${xmlEscape(value)}</value>`)
        .join("\n");
      return `    <dimension id="${xmlEscape(dimension.id)}" recordType="${xmlEscape(dimension.recordType)}">\n${values}\n    </dimension>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<share>\n  <fields>\n${fields}\n  </fields>\n  <dimensions>\n${dimensions}\n  </dimensions>\n</share>\n`;
}

const FAILURE_LIMIT = 5;
const BLOCK_MS = 60 * 60 * 1000;

/**
 * Failures are counted per endpoint and caller, so a bad caller cannot block anyone else.
 * When the caller's address is unknown (TRUST_PROXY not set), nothing is blocked: every
 * remote caller would share that bucket. The 256-bit secret is what protects the endpoint;
 * the block only cuts noise from a misconfigured client.
 */
function failureKey(endpointId: string, sourceIp: string) {
  return sourceIp === UNKNOWN_CLIENT ? null : `${endpointId}|${sourceIp}`;
}

export async function blockedIpUntil(endpointId: string, sourceIp: string) {
  const key = failureKey(endpointId, sourceIp);
  if (!key) return null;
  const row = await prisma.apiIpBlock.findUnique({ where: { key } });
  if (!row?.blockedUntil || row.blockedUntil.getTime() <= Date.now()) return null;
  return row.blockedUntil;
}

export async function noteSecretFailure(endpointId: string, sourceIp: string) {
  const key = failureKey(endpointId, sourceIp);
  if (!key) return { blocked: false, count: 0 };
  const now = new Date();
  const existing = await prisma.apiIpBlock.findUnique({ where: { key } });
  const blockExpired = Boolean(existing?.blockedUntil && existing.blockedUntil.getTime() <= now.getTime());
  const count = !existing || blockExpired ? 1 : existing.failureCount + 1;
  const blocked = count > FAILURE_LIMIT;
  const blockedUntil = blocked ? new Date(now.getTime() + BLOCK_MS) : null;
  await prisma.apiIpBlock.upsert({
    where: { key },
    create: { key, failureCount: count, blockedUntil },
    update: { failureCount: count, blockedUntil },
  });
  return { blocked, count };
}

export async function clearSecretFailures(endpointId: string, sourceIp: string) {
  const key = failureKey(endpointId, sourceIp);
  if (key) await prisma.apiIpBlock.deleteMany({ where: { key } });
}

export async function recordShareRequest(endpointId: string, sourceIp: string, status: number, result: string) {
  await prisma.apiRequestLog.create({
    data: { endpointId, sourceIp, status, result },
  });
  const stale = await prisma.apiRequestLog.findMany({
    where: { endpointId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: 50,
    select: { id: true },
  });
  if (stale.length) {
    await prisma.apiRequestLog.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
}
