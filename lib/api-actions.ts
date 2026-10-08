"use server";

import { randomBytes, randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function editor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canEditModule(access, "API_CONFIG")) redirect("/admin/api?error=You%20cannot%20change%20this.");
  return user;
}

function dateOrNull(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function newSecret() {
  return randomBytes(32).toString("base64url");
}

async function readScope(formData: FormData) {
  const categories = await prisma.category.findMany({
    include: { fields: { select: { id: true, categoryId: true } } },
  });
  const categoryRows: { categoryId: string; applyToFields: boolean }[] = [];
  const fieldRows: { fieldId: string }[] = [];
  for (const category of categories) {
    const scope = text(formData, `cat:${category.id}:scope`);
    if (scope === "category") {
      categoryRows.push({ categoryId: category.id, applyToFields: false });
    } else if (scope === "fields") {
      const chosen = category.fields.filter((field) => formData.get(`field:${field.id}`) === "on");
      if (!chosen.length) continue;
      categoryRows.push({ categoryId: category.id, applyToFields: true });
      fieldRows.push(...chosen.map((field) => ({ fieldId: field.id })));
    }
  }
  return { categoryRows, fieldRows };
}

async function writeScope(endpointId: string, categoryRows: { categoryId: string; applyToFields: boolean }[], fieldRows: { fieldId: string }[]) {
  await prisma.apiEndpointCategory.deleteMany({ where: { endpointId } });
  await prisma.apiEndpointField.deleteMany({ where: { endpointId } });
  await prisma.apiEndpointCategory.createMany({
    data: categoryRows.map((row) => ({ endpointId, ...row })),
  });
  if (fieldRows.length) {
    await prisma.apiEndpointField.createMany({
      data: fieldRows.map((row) => ({ endpointId, fieldId: row.fieldId })),
    });
  }
}

export async function saveApiEndpoint(formData: FormData) {
  await editor();
  const id = text(formData, "id");
  const name = text(formData, "name");
  const description = text(formData, "description");
  const format = text(formData, "format") === "XML" ? "XML" : "JSON";
  const secretOptional = formData.get("secretOptional") === "on";
  const validFrom = dateOrNull(text(formData, "validFrom"));
  const validTo = dateOrNull(text(formData, "validTo"));
  if (!name) redirect("/admin/api?error=A%20friendly%20name%20is%20required.");
  if (validFrom && validTo && validFrom > validTo) {
    redirect("/admin/api?error=The%20from%20date%20must%20be%20on%20or%20before%20the%20to%20date.");
  }
  const { categoryRows, fieldRows } = await readScope(formData);
  if (!categoryRows.length) redirect("/admin/api?error=Choose%20at%20least%20one%20category%20or%20field.");
  const data = { name, description, format, validFrom, validTo, secretOptional };
  const endpointId = id || randomUUID();
  if (id) await prisma.apiEndpoint.update({ where: { id }, data });
  else await prisma.apiEndpoint.create({ data: { id: endpointId, ...data, secret: newSecret() } });
  await writeScope(endpointId, categoryRows, fieldRows);
  revalidatePath("/admin/api");
  redirect("/admin/api?saved=1");
}

export async function setApiEndpointActive(formData: FormData) {
  await editor();
  const id = text(formData, "id");
  const isActive = text(formData, "active") === "1";
  if (id) await prisma.apiEndpoint.update({ where: { id }, data: { isActive } });
  revalidatePath("/admin/api");
  redirect("/admin/api?saved=1");
}

export async function regenerateApiSecret(formData: FormData) {
  await editor();
  const id = text(formData, "id");
  if (!id) redirect("/admin/api?error=Choose%20an%20endpoint.");
  await prisma.apiEndpoint.update({ where: { id }, data: { secret: newSecret() } });
  revalidatePath("/admin/api");
  redirect("/admin/api?saved=secret");
}
