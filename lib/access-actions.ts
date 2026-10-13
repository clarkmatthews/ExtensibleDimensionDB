"use server";

import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { GrantLevel, Prisma, SubjectType } from "@prisma/client";
import { NAV_MODULES, moduleHref, type NavModuleId } from "@/lib/nav-modules";
import { emailError, nameError, passwordError } from "@/lib/passwords";
import { audited } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { RIGHTS } from "@/lib/permission-labels";
import { canEditModule, categoryAccess, loadAccess, type StructureRight } from "@/lib/permissions";
import { currentSessionId, getCurrentUser, revokeAllSessions } from "@/lib/session";
import { parseOperator, TRIGGER_OPERATORS } from "@/lib/workflow-rules";
import {
  deleteWorkflowGraph,
  deleteWorkflowStepGraph,
  previewWorkflowDelete as previewWorkflowRemoval,
  previewWorkflowStepDelete as previewWorkflowStepRemoval,
} from "@/lib/workflow-delete";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function requireEdit(moduleId: NavModuleId) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canEditModule(access, moduleId)) {
    redirect(`${moduleHref(moduleId)}?error=${encodeURIComponent("You cannot change this.")}`);
  }
  return user;
}

export async function saveGroup(formData: FormData) {
  return audited("access.saveGroup", [formData], async () => {
    await requireEdit("ACCESS");
    const id = text(formData, "id");
    const name = text(formData, "name");
    const description = text(formData, "description");
    if (!name) redirect("/admin/access?error=Group%20name%20is%20required.");
    if (id) await prisma.group.update({ where: { id }, data: { name, description } });
    else await prisma.group.create({ data: { name, description } });
    revalidatePath("/admin/access");
  });
}

export async function setGroupActive(formData: FormData) {
  return audited("access.setGroupActive", [formData], async () => {
    await requireEdit("ACCESS");
    await prisma.group.update({
      where: { id: text(formData, "id") },
      data: { isActive: text(formData, "active") === "1" },
    });
    revalidatePath("/admin/access");
  });
}

function grantLevel(raw: string): "NONE" | "VIEW" | "EDIT" {
  return raw === "VIEW" || raw === "EDIT" ? raw : "NONE";
}

/** The dimensions this person may grant to others: all of them for an administrator. */
async function grantableCategories(formData: FormData) {
  const user = await requireEdit("ACCESS");
  const access = await loadAccess(user);
  const categories = await prisma.category.findMany({ include: { fields: true } });
  return categories.filter(
    (category) => formData.get(`cat:${category.id}:shown`) === "1" && (user.isAdmin || categoryAccess(access, category.id).canAssignPermissions),
  );
}

async function setFieldLevel(fieldId: string, subjectType: SubjectType, subjectId: string, level: "NONE" | "VIEW" | "EDIT" | null) {
  const key = { fieldId, subjectType, subjectId };
  if (level === null) {
    await prisma.fieldPermission.deleteMany({ where: key });
    return;
  }
  const grant = { canView: level !== "NONE", canUpdate: level === "EDIT" };
  await prisma.fieldPermission.upsert({
    where: { fieldId_subjectType_subjectId: key },
    update: grant,
    create: { ...key, ...grant },
  });
}

/** Everything a group grants: screens, and for each dimension its data access and admin rights. */
export async function saveGroupPermissions(formData: FormData) {
  return audited("access.saveGroupPermissions", [formData], async () => {
    const categories = await grantableCategories(formData);
    const groupId = text(formData, "groupId");
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) redirect("/admin/access?error=That%20group%20was%20not%20found.");
    for (const item of NAV_MODULES) {
      const chosen = text(formData, `nav:${item.id}`);
      if (!chosen) continue;
      const key = { module: item.id, subjectType: "GROUP" as const, subjectId: groupId };
      // A group grants View or Edit; None is simply no grant.
      if (chosen !== "VIEW" && chosen !== "EDIT") {
        await prisma.modulePermission.deleteMany({ where: key });
        continue;
      }
      await prisma.modulePermission.upsert({
        where: { module_subjectType_subjectId: key },
        update: { grantLevel: chosen },
        create: { ...key, grantLevel: chosen },
      });
    }
    for (const category of categories) {
      const level = grantLevel(text(formData, `cat:${category.id}:level`));
      const applyToFields = text(formData, `cat:${category.id}:scope`) === "fields";
      const key = { categoryId: category.id, subjectType: "GROUP" as const, subjectId: groupId };
      const rights = Object.fromEntries(
        RIGHTS.map((item) => [item.right, formData.get(`cat:${category.id}:${item.key}`) === "on"]),
      ) as Record<StructureRight, boolean>;
      const fieldLevels = category.fields.map((field) => ({
        fieldId: field.id,
        level: grantLevel(text(formData, `field:${field.id}:level`)),
      }));
      const canViewData = applyToFields ? fieldLevels.some((item) => item.level !== "NONE") : level !== "NONE";
      if (canViewData || applyToFields || Object.values(rights).some(Boolean)) {
        const grant = { ...rights, canViewData, grantLevel: applyToFields ? ("NONE" as const) : level, applyToFields };
        await prisma.categoryPermission.upsert({
          where: { categoryId_subjectType_subjectId: key },
          update: grant,
          create: { ...key, ...grant },
        });
      } else {
        await prisma.categoryPermission.deleteMany({ where: key });
      }
      for (const item of fieldLevels) {
        await setFieldLevel(item.fieldId, "GROUP", groupId, applyToFields && item.level !== "NONE" ? item.level : null);
      }
    }
    revalidatePath("/", "layout");
    redirect(`/admin/access?saved=group&open=${groupId}#group-${groupId}`);
  });
}

function userReturn(id: string) {
  return id ? `/admin/users/${id}` : "/admin/users";
}

export async function saveUser(formData: FormData) {
  return audited("access.saveUser", [formData], async () => {
    const actor = await requireEdit("USERS");
    const id = text(formData, "id");
    const name = text(formData, "name");
    const email = text(formData, "email").toLowerCase();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const groupIds = formData.getAll("groupId").map(String);
    const destination = userReturn(id);
    const invalidName = nameError(name);
    if (invalidName) redirect(`${destination}?error=${encodeURIComponent(invalidName)}`);
    const invalidEmail = emailError(email);
    if (invalidEmail) redirect(`${destination}?error=${encodeURIComponent(invalidEmail)}`);
    const changingPassword = password.length > 0;
    if (!id && !changingPassword) redirect(`${destination}?error=${encodeURIComponent("A password is required for a new user.")}`);
    if (changingPassword && password !== confirmPassword) {
      redirect(`${destination}?error=${encodeURIComponent("Password and confirmation do not match.")}`);
    }
    if (changingPassword) {
      const invalidPassword = passwordError(password, { name, email });
      if (invalidPassword) redirect(`${destination}?error=${encodeURIComponent(invalidPassword)}`);
    }
    const existing = id ? await prisma.user.findUnique({ where: { id } }) : null;
    const isAdmin = actor.isAdmin ? formData.get("isAdmin") === "on" : (existing?.isAdmin ?? false);
    if (id === actor.id && !isAdmin) {
      redirect(`${destination}?error=${encodeURIComponent("You cannot remove your own administrator access.")}`);
    }
    const data = {
      name,
      email,
      isAdmin,
      canDefineWorkflows: actor.isAdmin ? formData.get("canDefineWorkflows") === "on" : (existing?.canDefineWorkflows ?? false),
      ...(changingPassword
        ? {
            passwordHash: await hash(password, 10),
            // A password someone else chose is temporary: a non-administrator picks their own at next sign-in.
            mustChangePassword: id !== actor.id && !isAdmin,
          }
        : {}),
    };
    let user;
    try {
      user = id
        ? await prisma.user.update({ where: { id }, data })
        : await prisma.user.create({ data: { ...data, passwordHash: data.passwordHash! } });
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError).code === "P2002") {
        redirect(`${destination}?error=${encodeURIComponent("That email address is already in use.")}`);
      }
      throw error;
    }
    if (id && changingPassword) {
      // A new password signs the person out everywhere else. When people change their own
      // password, the browser they are using stays signed in.
      await revokeAllSessions(user.id, id === actor.id ? ((await currentSessionId()) ?? undefined) : undefined);
    }
    await prisma.userGroup.deleteMany({ where: { userId: user.id } });
    if (groupIds.length) {
      await prisma.userGroup.createMany({
        data: groupIds.map((groupId) => ({ userId: user.id, groupId })),
      });
    }
    await prisma.workflowStep.updateMany({
      where: {
        assigneeUserId: user.id,
        ...(groupIds.length ? { groupId: { notIn: groupIds } } : {}),
      },
      data: { assigneeUserId: null },
    });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${user.id}`);
    revalidatePath("/admin/workflows");
    redirect(`/admin/users/${user.id}?saved=account`);
  });
}

export async function setUserActive(formData: FormData) {
  return audited("access.setUserActive", [formData], async () => {
    const actor = await requireEdit("USERS");
    const id = text(formData, "id");
    if (id === actor.id) redirect(`/admin/users/${id}?error=${encodeURIComponent("You cannot disable your own account.")}`);
    const isActive = text(formData, "active") === "1";
    await prisma.user.update({ where: { id }, data: { isActive } });
    if (!isActive) await revokeAllSessions(id);
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${id}`);
    redirect(`/admin/users/${id}?saved=account`);
  });
}

/**
 * A person's own settings. Each screen, dimension, right, and attribute either follows their groups
 * (nothing stored) or is set for this person alone, overriding the groups for that item only.
 */
export async function saveUserOverrides(formData: FormData) {
  return audited("access.saveUserOverrides", [formData], async () => {
    const categories = await grantableCategories(formData);
    const subjectId = text(formData, "userId");
    const person = await prisma.user.findUnique({ where: { id: subjectId } });
    if (!person) redirect("/admin/users?error=That%20person%20was%20not%20found.");
    const subjectType = "USER" as const;
    for (const item of NAV_MODULES) {
      const chosen = text(formData, `nav:${item.id}`);
      if (!chosen) continue;
      const key = { module: item.id, subjectType, subjectId };
      if (chosen === "INHERIT") {
        await prisma.modulePermission.deleteMany({ where: key });
        continue;
      }
      const level = grantLevel(chosen);
      await prisma.modulePermission.upsert({
        where: { module_subjectType_subjectId: key },
        update: { grantLevel: level },
        create: { ...key, grantLevel: level },
      });
    }
    for (const category of categories) {
      const key = { categoryId: category.id, subjectType, subjectId };
      const rights = Object.fromEntries(
        RIGHTS.map((item) => {
          const chosen = text(formData, `cat:${category.id}:${item.key}`);
          return [item.right, chosen === "YES" ? true : chosen === "NO" ? false : null];
        }),
      ) as Record<StructureRight, boolean | null>;
      const data = text(formData, `cat:${category.id}:data`);
      const applyToFields = data === "FIELDS";
      const level: GrantLevel | null = data === "NONE" || data === "VIEW" || data === "EDIT" ? data : null;
      if (applyToFields || level || Object.values(rights).some((value) => value !== null)) {
        const grant = { ...rights, grantLevel: level, applyToFields, canViewData: applyToFields || level === "VIEW" || level === "EDIT" };
        await prisma.categoryPermission.upsert({
          where: { categoryId_subjectType_subjectId: key },
          update: grant,
          create: { ...key, ...grant },
        });
      } else {
        await prisma.categoryPermission.deleteMany({ where: key });
      }
      for (const field of category.fields) {
        const chosen = text(formData, `field:${field.id}:level`);
        // Attribute settings apply only under Specific attributes.
        const fieldLevel = applyToFields && (chosen === "NONE" || chosen === "VIEW" || chosen === "EDIT") ? chosen : null;
        await setFieldLevel(field.id, subjectType, subjectId, fieldLevel);
      }
    }
    revalidatePath("/", "layout");
    redirect(`/admin/users/${subjectId}?saved=permissions#own-settings`);
  });
}

export async function saveWorkflow(formData: FormData) {
  return audited("access.saveWorkflow", [formData], async () => {
    await requireEdit("WORKFLOWS");
    const id = text(formData, "id");
    const name = text(formData, "name");
    if (!name) redirect("/admin/workflows?error=Process%20name%20is%20required.");
    // The kind is chosen when a workflow is created; changing it later goes through changeWorkflowKind.
    const existing = id ? await prisma.workflowProcess.findUnique({ where: { id }, select: { kind: true } }) : null;
    if (id && !existing) redirect("/admin/workflows?error=That%20workflow%20was%20not%20found.");
    const kind = existing ? existing.kind : text(formData, "kind") === "NOTIFY" ? "NOTIFY" : "TASK";
    const onCreate = formData.get("onCreate") === "on";
    const onChange = formData.get("onChange") === "on";
    const manual = formData.get("manual") === "on";
    const data = {
      name,
      description: text(formData, "description"),
      kind,
      onCreate,
      onChange,
      manual: kind === "TASK" && manual,
      isActive: formData.get("isActive") === "on",
      isDefault: onCreate,
    } as const;
    const process = id
      ? await prisma.workflowProcess.update({ where: { id }, data })
      : await prisma.workflowProcess.create({ data });
    if (id) {
      const categoryIds = formData.getAll("categoryId").map(String).filter(Boolean);
      const triggerIds = formData.getAll("triggerFieldId").map(String).filter(Boolean);
      await prisma.workflowProcessCategory.deleteMany({ where: { processId: process.id } });
      if (categoryIds.length) {
        await prisma.workflowProcessCategory.createMany({
          data: categoryIds.map((categoryId) => ({ processId: process.id, categoryId })),
        });
      }
      await prisma.workflowTriggerField.deleteMany({ where: { processId: process.id } });
      if (triggerIds.length) {
        await prisma.workflowTriggerField.createMany({
          data: triggerIds.map((fieldId) => {
            const operator = parseOperator(text(formData, `op:${fieldId}`));
            const needsValue = TRIGGER_OPERATORS.find((item) => item.value === operator)?.needsValue;
            return { processId: process.id, fieldId, operator, matchValue: needsValue ? text(formData, `match:${fieldId}`) : "" };
          }),
        });
      }
      // Recipients are only on a Notify workflow's form; saving any other form leaves them as they are.
      if (kind === "NOTIFY" && formData.has("recipientsShown")) {
        await prisma.workflowRecipient.deleteMany({ where: { processId: process.id } });
        const recipients = [
          ...formData.getAll("recipientGroup").map(String).filter(Boolean).map((groupId) => ({ processId: process.id, groupId, userId: null })),
          ...formData.getAll("recipientUser").map(String).filter(Boolean).map((userId) => ({ processId: process.id, groupId: null, userId })),
        ];
        if (recipients.length) await prisma.workflowRecipient.createMany({ data: recipients });
      }
    }
    revalidatePath("/admin/workflows");
    // A new workflow opens straight away, so its triggers, recipients or steps can be set.
    if (!id) redirect(`/admin/workflows?open=${process.id}`);
  });
}

export async function saveWorkflowStep(formData: FormData) {
  return audited("access.saveWorkflowStep", [formData], async () => {
    await requireEdit("WORKFLOWS");
    const processId = text(formData, "processId");
    const id = text(formData, "id");
    const name = text(formData, "name");
    const kind = text(formData, "kind") === "NOTIFY" ? "NOTIFY" : "ACTION";
    const groupId = text(formData, "groupId") || null;
    // An action step has an assignee within its group; a notify step names any person to notify.
    const assigneeUserId = (kind === "NOTIFY" ? text(formData, "notifyUserId") : text(formData, "assigneeUserId")) || null;
    const deadlineDays = Number(text(formData, "deadlineDays") || "1");
    const knownFields = await prisma.fieldDefinition.findMany({ select: { id: true } });
    const rules = kind === "NOTIFY" ? [] : knownFields.flatMap((field) => {
      const rule = text(formData, `rule:${field.id}`);
      if (rule !== "MUST_HAVE_VALUE" && rule !== "MUST_CHANGE") return [];
      return [{ fieldId: field.id, rule: rule as "MUST_HAVE_VALUE" | "MUST_CHANGE" }];
    });
    if (!name) redirect("/admin/workflows?error=Step%20name%20is%20required.");
    if (kind === "ACTION" && !groupId) redirect("/admin/workflows?error=An%20action%20step%20needs%20a%20group.");
    if (kind === "NOTIFY" && !groupId && !assigneeUserId) {
      redirect("/admin/workflows?error=A%20notify%20step%20needs%20a%20group%20or%20a%20person%20to%20notify.");
    }
    if (kind === "ACTION" && assigneeUserId && groupId) {
      const member = await prisma.userGroup.findFirst({
        where: { userId: assigneeUserId, groupId, user: { isActive: true } },
      });
      if (!member) redirect("/admin/workflows?error=The%20assigned%20user%20must%20be%20an%20active%20member%20of%20the%20step%20group.");
    }
    if (kind === "NOTIFY" && assigneeUserId) {
      const person = await prisma.user.findFirst({ where: { id: assigneeUserId, isActive: true }, select: { id: true } });
      if (!person) redirect("/admin/workflows?error=Choose%20an%20active%20person%20to%20notify.");
    }
    const days = Number.isFinite(deadlineDays) && deadlineDays >= 1 ? Math.floor(deadlineDays) : 1;
    const last = await prisma.workflowStep.aggregate({ where: { processId }, _max: { sortOrder: true } });
    const step = id
      ? await prisma.workflowStep.update({
          where: { id },
          data: { name, kind, groupId, assigneeUserId, ...(kind === "ACTION" ? { deadlineDays: days } : {}) },
        })
      : await prisma.workflowStep.create({
          data: {
            processId,
            name,
            kind,
            groupId,
            assigneeUserId,
            deadlineDays: days,
            sortOrder: (last._max.sortOrder ?? 0) + 1,
          },
        });
    await prisma.workflowStepField.deleteMany({ where: { stepId: step.id } });
    if (rules.length) {
      await prisma.workflowStepField.createMany({
        data: rules.map((rule) => ({ stepId: step.id, fieldId: rule.fieldId, rule: rule.rule })),
      });
    }
    revalidatePath("/admin/workflows");
    revalidatePath("/admin/users");
  });
}

/** For the delete dialogs, which call these directly: an error to show instead of a redirect. */
async function workflowEditError() {
  const user = await getCurrentUser();
  if (!user) return "You are not signed in.";
  return canEditModule(await loadAccess(user), "WORKFLOWS") ? "" : "Edit access to Workflows is required.";
}

export async function previewWorkflowDelete(id: string) {
  const blocked = await workflowEditError();
  if (blocked) return { error: blocked, title: "", message: "" };
  return previewWorkflowRemoval(prisma, id);
}

export async function deleteWorkflow(id: string) {
  return audited("access.deleteWorkflow", [id], async () => {
    const blocked = await workflowEditError();
    if (blocked) return { error: blocked };
    const error = await prisma.$transaction((tx) => deleteWorkflowGraph(tx, id));
    if (error) return { error };
    revalidatePath("/admin/workflows");
    revalidatePath("/admin/users");
    revalidatePath("/dashboard");
    return { error: "" };
  });
}

export async function previewWorkflowStepDelete(id: string) {
  const blocked = await workflowEditError();
  if (blocked) return { error: blocked, title: "", message: "" };
  return previewWorkflowStepRemoval(prisma, id);
}

export async function deleteWorkflowStep(id: string) {
  return audited("access.deleteWorkflowStep", [id], async () => {
    const blocked = await workflowEditError();
    if (blocked) return { error: blocked };
    const error = await prisma.$transaction((tx) => deleteWorkflowStepGraph(tx, id));
    if (error) return { error };
    revalidatePath("/admin/workflows");
    revalidatePath("/admin/users");
    return { error: "" };
  });
}

async function kindChange(id: string) {
  const process = await prisma.workflowProcess.findUnique({
    where: { id },
    include: { _count: { select: { steps: true, recipients: true } } },
  });
  if (!process) return null;
  const open = await prisma.storeProcess.count({ where: { processId: id, status: { in: ["ACTIVE", "SUSPENDED"] } } });
  return { process, open, to: process.kind === "NOTIFY" ? ("TASK" as const) : ("NOTIFY" as const) };
}

export async function previewWorkflowKindChange(id: string) {
  const blocked = await workflowEditError();
  if (blocked) return { error: blocked, title: "", message: "" };
  const change = await kindChange(id);
  if (!change) return { error: "This workflow was not found.", title: "", message: "" };
  const { process, open, to } = change;
  const sentences: string[] = [];
  if (to === "NOTIFY") {
    sentences.push(`${process.name} will send notices instead of assigning actions.`);
    if (process._count.steps) sentences.push(`Its ${process._count.steps === 1 ? "step is" : `${process._count.steps} steps are`} hidden and kept, in case you change it back. Manual start is turned off.`);
    if (open) sentences.push(`${open === 1 ? "1 record has" : `${open} records have`} it open; those actions continue until they are finished.`);
    sentences.push("Choose who to notify after the change.");
  } else {
    sentences.push(`${process.name} will assign actions instead of sending notices.`);
    if (process._count.recipients) sentences.push("Its notify list is hidden and kept, in case you change it back.");
    sentences.push("Add steps after the change.");
  }
  return { error: "", title: `Change ${process.name} to ${to === "NOTIFY" ? "Notify" : "Action sequence"}?`, message: sentences.join(" ") };
}

export async function changeWorkflowKind(id: string) {
  return audited("access.changeWorkflowKind", [id], async () => {
    const blocked = await workflowEditError();
    if (blocked) return { error: blocked };
    const change = await kindChange(id);
    if (!change) return { error: "This workflow was not found." };
    await prisma.workflowProcess.update({
      where: { id },
      data: { kind: change.to, ...(change.to === "NOTIFY" ? { manual: false } : {}) },
    });
    revalidatePath("/admin/workflows");
    return { error: "" };
  });
}

export async function saveUserWorkflowSteps(formData: FormData) {
  return audited("access.saveUserWorkflowSteps", [formData], async () => {
    await requireEdit("USERS");
    const userId = text(formData, "userId");
    const account = await prisma.user.findUnique({ where: { id: userId }, include: { groups: true } });
    if (!account) redirect("/admin/users?error=That%20user%20was%20not%20found.");
    const groupIds = new Set(account.groups.map((membership) => membership.groupId));
    const selected = new Set(formData.getAll("stepId").map(String));
    // Only action steps are assigned to a person here; a notify step's person is set on the workflow.
    const steps = await prisma.workflowStep.findMany({ where: { kind: "ACTION" } });
    if (steps.some((step) => selected.has(step.id) && (!step.groupId || !groupIds.has(step.groupId)))) {
      redirect(`/admin/users/${userId}?error=${encodeURIComponent("Assign the user to the step's group before giving them that workflow step.")}`);
    }
    for (const step of steps) {
      if (selected.has(step.id)) {
        await prisma.workflowStep.update({ where: { id: step.id }, data: { assigneeUserId: userId } });
      } else if (step.assigneeUserId === userId) {
        await prisma.workflowStep.update({ where: { id: step.id }, data: { assigneeUserId: null } });
      }
    }
    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/admin/workflows");
    redirect(`/admin/users/${userId}?saved=workflows`);
  });
}

export async function moveWorkflowStep(formData: FormData) {
  return audited("access.moveWorkflowStep", [formData], async () => {
    await requireEdit("WORKFLOWS");
    const id = text(formData, "id");
    const step = await prisma.workflowStep.findUnique({ where: { id } });
    if (!step) return;
    const steps = await prisma.workflowStep.findMany({
      where: { processId: step.processId },
      orderBy: { sortOrder: "asc" },
    });
    const index = steps.findIndex((item) => item.id === id);
    const direction = text(formData, "direction") === "up" ? -1 : 1;
    const swap = steps[index + direction];
    if (!swap) return;
    await prisma.$transaction([
      prisma.workflowStep.update({ where: { id }, data: { sortOrder: swap.sortOrder } }),
      prisma.workflowStep.update({ where: { id: swap.id }, data: { sortOrder: steps[index].sortOrder } }),
    ]);
    revalidatePath("/admin/workflows");
  });
}

/** Ends every signed-in session for a person. Used when a device is lost or an account may be compromised. */
export async function signOutEverywhere(formData: FormData) {
  return audited("session.signOutEverywhere", [formData], async () => {
    const actor = await requireEdit("USERS");
    const id = text(formData, "id");
    if (!id) redirect("/admin/users");
    const keep = id === actor.id ? ((await currentSessionId()) ?? undefined) : undefined;
    await revokeAllSessions(id, keep);
    revalidatePath(`/admin/users/${id}`);
    redirect(`/admin/users/${id}?saved=sessions`);
  });
}
