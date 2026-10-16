"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audited } from "@/lib/audit";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SCOPE_ATTRIBUTE_TYPES } from "@/lib/row-scope";
import { getCurrentUser } from "@/lib/session";

const PAGE = "/admin/scopes";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function fail(message: string): never {
  redirect(`${PAGE}?error=${encodeURIComponent(message)}`);
}

async function requireEdit() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canEditModule(access, "ACCESS")) fail("You cannot change scopes.");
  return user;
}

export async function saveScope(formData: FormData) {
  return audited("scopes.save", [formData], async () => {
    await requireEdit();
    const id = text(formData, "id");
    const name = text(formData, "name");
    const description = text(formData, "description");
    if (!name) fail("A scope needs a name.");
    if (id) {
      await prisma.scope.update({ where: { id }, data: { name, description } });
      revalidatePath(PAGE);
      redirect(`${PAGE}?open=${id}&saved=scope`);
    }
    const scope = await prisma.scope.create({ data: { name, description } });
    revalidatePath(PAGE);
    redirect(`${PAGE}?open=${scope.id}&saved=scope`);
  });
}

export async function setScopeActive(formData: FormData) {
  return audited("scopes.setActive", [formData], async () => {
    await requireEdit();
    const id = text(formData, "id");
    await prisma.scope.update({ where: { id }, data: { isActive: text(formData, "active") === "1" } });
    revalidatePath(PAGE);
    redirect(`${PAGE}?open=${id}&saved=scope`);
  });
}

export async function deleteScope(formData: FormData) {
  return audited("scopes.delete", [formData], async () => {
    await requireEdit();
    await prisma.scope.delete({ where: { id: text(formData, "id") } });
    revalidatePath(PAGE);
    revalidatePath("/admin/access");
    redirect(`${PAGE}?saved=deleted`);
  });
}

export async function saveScopeRule(formData: FormData) {
  return audited("scopes.saveRule", [formData], async () => {
    await requireEdit();
    const scopeId = text(formData, "scopeId");
    const ruleId = text(formData, "ruleId");
    const recordTypeId = text(formData, "recordTypeId");
    const kind = text(formData, "kind") === "ATTRIBUTE" ? "ATTRIBUTE" : "RECORDS";
    const scope = await prisma.scope.findUnique({ where: { id: scopeId }, select: { id: true } });
    if (!scope) fail("That scope was not found.");
    if (ruleId) {
      const current = await prisma.scopeRule.findUnique({ where: { id: ruleId }, select: { scopeId: true } });
      if (!current || current.scopeId !== scopeId) fail("That rule was not found.");
    }
    const recordType = await prisma.recordType.findFirst({ where: { id: recordTypeId, isActive: true }, select: { id: true } });
    if (!recordType) fail("Choose a record type.");

    let fieldId: string | null = null;
    let sourceRuleId: string | null = null;
    let recordIds: string[] = [];
    let values: string[] = [];

    if (kind === "RECORDS") {
      recordIds = [...new Set(formData.getAll("locationId").map(String).filter(Boolean))].slice(0, 500);
      if (!recordIds.length) fail("Choose at least one record.");
      const found = await prisma.location.findMany({ where: { id: { in: recordIds }, recordTypeId }, select: { id: true } });
      if (found.length !== recordIds.length) fail("Choose records of that type.");
    } else {
      fieldId = text(formData, "fieldId");
      const field = await prisma.fieldDefinition.findUnique({
        where: { id: fieldId },
        select: { id: true, dataType: true, linkTypeId: true, category: { select: { recordTypeId: true } } },
      });
      if (!field || field.category.recordTypeId !== recordTypeId || !(SCOPE_ATTRIBUTE_TYPES as readonly string[]).includes(field.dataType)) {
        fail("Choose a text, choice, or link attribute.");
      }
      sourceRuleId = text(formData, "sourceRuleId") || null;
      if (sourceRuleId) {
        if (sourceRuleId === ruleId) fail("A rule cannot use itself as its record list.");
        const source = await prisma.scopeRule.findUnique({ where: { id: sourceRuleId }, select: { scopeId: true, kind: true, recordTypeId: true } });
        if (!source || source.scopeId !== scopeId || source.kind !== "RECORDS") fail("Choose a record list from this scope.");
        if (field.dataType === "RECORD_LINK" && source.recordTypeId !== field.linkTypeId) {
          fail("That record list is a different record type than this link.");
        }
      }
      const posted = [
        ...formData.getAll("value").map(String),
        ...text(formData, "values").split(/\r?\n/),
      ].map((value) => value.trim()).filter(Boolean);
      values = [...new Set(posted)].slice(0, 200);
      if (!values.length && !sourceRuleId) fail("Enter at least one value, or choose a record list.");
    }

    const data = { recordTypeId, kind, fieldId, sourceRuleId } as const;
    const rule = ruleId
      ? await prisma.scopeRule.update({ where: { id: ruleId }, data })
      : await prisma.scopeRule.create({ data: { scopeId, ...data } });
    await prisma.scopeRuleRecord.deleteMany({ where: { ruleId: rule.id } });
    await prisma.scopeRuleValue.deleteMany({ where: { ruleId: rule.id } });
    if (recordIds.length) {
      await prisma.scopeRuleRecord.createMany({ data: recordIds.map((locationId) => ({ ruleId: rule.id, locationId })) });
    }
    if (values.length) {
      await prisma.scopeRuleValue.createMany({ data: values.map((valueText) => ({ ruleId: rule.id, valueText })) });
    }
    revalidatePath(PAGE);
    redirect(`${PAGE}?open=${scopeId}&saved=rule`);
  });
}

export async function deleteScopeRule(formData: FormData) {
  return audited("scopes.deleteRule", [formData], async () => {
    await requireEdit();
    const scopeId = text(formData, "scopeId");
    const rule = await prisma.scopeRule.findUnique({ where: { id: text(formData, "ruleId") }, select: { scopeId: true } });
    if (!rule || rule.scopeId !== scopeId) fail("That rule was not found.");
    await prisma.scopeRule.delete({ where: { id: text(formData, "ruleId") } });
    revalidatePath(PAGE);
    redirect(`${PAGE}?open=${scopeId}&saved=rule`);
  });
}

/** Replaces the scopes assigned directly to one group or person. Group scopes are not changed from a person's page. */
export async function saveSubjectScopes(formData: FormData) {
  return audited("scopes.assign", [formData], async () => {
    await requireEdit();
    const subjectType = text(formData, "subjectType") === "USER" ? "USER" : "GROUP";
    const subjectId = text(formData, "subjectId");
    const back = text(formData, "returnTo");
    const destination = back.startsWith("/admin/") ? back.split("?")[0] : subjectType === "USER" ? `/admin/users/${subjectId}` : "/admin/access";
    if (subjectType === "GROUP") {
      const group = await prisma.group.findUnique({ where: { id: subjectId }, select: { id: true } });
      if (!group) redirect(`${destination}?error=${encodeURIComponent("That group was not found.")}`);
    } else {
      const person = await prisma.user.findUnique({ where: { id: subjectId }, select: { id: true } });
      if (!person) redirect(`${destination}?error=${encodeURIComponent("That person was not found.")}`);
    }
    const requested = [...new Set(formData.getAll("scopeId").map(String).filter(Boolean))];
    const scopes = requested.length
      ? await prisma.scope.findMany({ where: { id: { in: requested } }, select: { id: true } })
      : [];
    await prisma.scopeAssignment.deleteMany({ where: { subjectType, subjectId } });
    if (scopes.length) {
      await prisma.scopeAssignment.createMany({
        data: scopes.map((scope) => ({ scopeId: scope.id, subjectType, subjectId })),
      });
    }
    revalidatePath(PAGE);
    revalidatePath("/admin/access");
    revalidatePath("/admin/users");
    const join = destination.includes("?") ? "&" : "?";
    redirect(`${destination}${join}saved=scopes${subjectType === "GROUP" ? `&open=${subjectId}` : ""}`);
  });
}
