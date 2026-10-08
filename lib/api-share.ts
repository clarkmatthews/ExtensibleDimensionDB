import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { clientAddress } from "@/lib/client-address";
import { prisma } from "@/lib/prisma";
import { storedToDisplay, type DefinedField } from "@/lib/values";

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
  choices?: ShareChoice[];
};

export type SharePayload = {
  fields: ShareField[];
  dimensions: { id: string; values: Record<string, string> }[];
};

export function bearerSecret(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function sourceIp(request: NextRequest) {
  return clientAddress(request.headers);
}

export function secretsMatch(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
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
      include: { options: { orderBy: { sortOrder: "asc" } }, category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
  ]);
  const pickedIds = new Set(picked.map((row) => row.fieldId));
  const wholeCategories = new Set(scopes.filter((row) => !row.applyToFields).map((row) => row.categoryId));
  const specificCategories = new Set(scopes.filter((row) => row.applyToFields).map((row) => row.categoryId));
  return definitions.filter((field) => {
    if (wholeCategories.has(field.categoryId)) return field.isActive;
    return specificCategories.has(field.categoryId) && pickedIds.has(field.id);
  });
}

export function shareField(field: DefinedField & { category: { name: string } }): ShareField {
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
  };
  if (field.options.length) {
    result.choices = field.options.map((option) => ({ label: option.label, value: option.value }));
  }
  return result;
}

export async function buildShare(endpointId: string): Promise<SharePayload> {
  const fields = await fieldsForEndpoint(endpointId);
  const activeFields = await prisma.fieldDefinition.findMany({
    where: { isActiveFilter: true, dataType: "CHECKBOX" },
    select: { id: true },
  });
  const activeIds = new Set(activeFields.map((field) => field.id));
  const locations = await prisma.location.findMany({
    where: { isActive: true },
    include: { values: true },
    orderBy: { createdAt: "desc" },
  });
  const openLocations = activeIds.size
    ? locations.filter((location) =>
        location.values.some((value) => activeIds.has(value.fieldId) && value.valueBoolean === true),
      )
    : locations;
  return {
    fields: fields.map(shareField),
    dimensions: openLocations.map((location) => ({
      id: location.id,
      values: Object.fromEntries(
        fields.map((field) => {
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
        `    <field key="${xmlEscape(field.key)}" name="${xmlEscape(field.name)}" category="${xmlEscape(field.category)}" dataType="${xmlEscape(field.dataType)}" required="${field.required}" uniqueIdentifier="${field.uniqueIdentifier}">`,
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
      return `    <dimension id="${xmlEscape(dimension.id)}">\n${values}\n    </dimension>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<share>\n  <fields>\n${fields}\n  </fields>\n  <dimensions>\n${dimensions}\n  </dimensions>\n</share>\n`;
}

const FAILURE_LIMIT = 5;
const BLOCK_MS = 60 * 60 * 1000;

export async function blockedIpUntil(sourceIp: string) {
  const row = await prisma.apiIpBlock.findUnique({ where: { sourceIp } });
  if (!row?.blockedUntil || row.blockedUntil.getTime() <= Date.now()) return null;
  return row.blockedUntil;
}

export async function noteSecretFailure(sourceIp: string) {
  const now = new Date();
  const existing = await prisma.apiIpBlock.findUnique({ where: { sourceIp } });
  const blockExpired = Boolean(existing?.blockedUntil && existing.blockedUntil.getTime() <= now.getTime());
  const count = !existing || blockExpired ? 1 : existing.failureCount + 1;
  const blocked = count > FAILURE_LIMIT;
  await prisma.apiIpBlock.upsert({
    where: { sourceIp },
    create: {
      sourceIp,
      failureCount: count,
      blockedUntil: blocked ? new Date(now.getTime() + BLOCK_MS) : null,
    },
    update: {
      failureCount: count,
      blockedUntil: blocked ? new Date(now.getTime() + BLOCK_MS) : null,
    },
  });
  return { blocked, count };
}

export async function clearSecretFailures(sourceIp: string) {
  await prisma.apiIpBlock.deleteMany({ where: { sourceIp } });
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
