"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audited } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { identifierTaken, loadSaveContext, saveRecord, type LoadedField } from "@/lib/record-save";
import { resolveRecordType } from "@/lib/record-types";
import { getCurrentUser } from "@/lib/session";
import { enqueueRecordEvent } from "@/lib/webhooks";
import { runWorkflows, startManualProcess } from "@/lib/workflow";

async function actor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return { user, access: await loadAccess(user) };
}

export async function saveStore(formData: FormData) {
  const { user, access } = await actor();
  if (!canEditModule(access, "STORES")) return { error: "You cannot change dimensions." };
  const locationId = String(formData.get("locationId") ?? "");
  // An existing record keeps its type; a new one takes the type it was created from.
  const recordTypeId = locationId
    ? (await prisma.location.findUnique({ where: { id: locationId }, select: { recordTypeId: true } }))?.recordTypeId
    : (await resolveRecordType(String(formData.get("recordTypeId") ?? ""))).current?.id;
  if (!recordTypeId) return { error: locationId ? "This record no longer exists." : "Choose a record type." };
  const submitted = (field: LoadedField) => {
    const values = formData.getAll(`field:${field.id}`).map(String);
    return field.multiple ? values.filter(Boolean).join("|") : (values[0] ?? "");
  };
  const result = await saveRecord({
    ctx: await loadSaveContext(recordTypeId),
    access,
    userId: user.id,
    locationId,
    // The form posts every attribute the person can update. A missing checkbox or an empty
    // multiple choice is absent from the post, which means "cleared".
    values: (field) => submitted(field),
    // A parent the person cannot edit is not posted, so its stored value decides the choices.
    parentValues: (field) => (formData.has(`field:${field.id}`) ? submitted(field) : undefined),
  });
  if (result.error !== undefined) return { error: result.error };
  const location = { id: result.locationId };
  const changes = result.changes;

  await runWorkflows({
    locationId: location.id,
    userId: user.id,
    userName: user.name,
    created: !locationId,
    changes,
  });
  await enqueueRecordEvent({ event: result.created ? "record.created" : "record.updated", locationId: location.id, actorName: user.name, changes });
  revalidatePath("/dimensions");
  revalidatePath("/dashboard");
  revalidatePath("/changelog");
  // A new record returns to its record type's list, which confirms it and links to it.
  // Saving an existing record stays on that record.
  if (result.created) redirect(`/dimensions?type=${encodeURIComponent(recordTypeId)}&created=${encodeURIComponent(location.id)}`);
  redirect(`/dimensions/${location.id}`);
}

export async function startWorkflow(formData: FormData) {
  const { user, access } = await actor();
  if (!canEditModule(access, "STORES")) redirect("/dimensions?error=You%20cannot%20change%20dimensions.");
  const locationId = String(formData.get("locationId") ?? "");
  const processId = String(formData.get("processId") ?? "");
  const target = await prisma.location.findUnique({ where: { id: locationId }, select: { isActive: true } });
  const error = !target?.isActive ? "Restore this record before starting a workflow." : await startManualProcess(locationId, processId, user.id);
  revalidatePath("/dashboard");
  revalidatePath(`/dimensions/${locationId}`);
  redirect(error ? `/dimensions/${locationId}?error=${encodeURIComponent(error)}` : `/dimensions/${locationId}`);
}

export async function taskAction(formData: FormData) {
  const { user, access } = await actor();
  if (!canEditModule(access, "INBOX")) redirect("/dashboard?error=You%20cannot%20change%20actions.");
  const { applyTaskAction } = await import("@/lib/workflow");
  const error = await applyTaskAction({
    taskId: String(formData.get("taskId") ?? ""),
    userId: user.id,
    action: String(formData.get("action") ?? ""),
    comment: String(formData.get("comment") ?? ""),
    keepWatching: formData.get("keepWatching") === "on",
    assigneeUserId: String(formData.get("assigneeUserId") ?? "") || undefined,
    postponeDays: Number(formData.get("postponeDays") ?? "") || undefined,
    nextDeadlineDays: Number(formData.get("nextDeadlineDays") ?? "") || undefined,
  });
  revalidatePath("/dashboard");
  revalidatePath("/reports/tasks");
  const returnTo = String(formData.get("returnTo") ?? "");
  const dest = returnTo.startsWith("/reports/tasks") || returnTo.startsWith("/dashboard") ? returnTo.split("?")[0] : "/dashboard";
  redirect(error ? `${dest}?error=${encodeURIComponent(error)}` : dest);
}

/** Archives a record: hides it everywhere, blocks edits, and pauses its open workflows. */
export async function archiveRecord(formData: FormData) {
  const locationId = String(formData.get("locationId") ?? "");
  return audited("records.archive", [formData], async () => {
    const { user, access } = await actor();
    if (!canEditModule(access, "STORES")) redirect(`/dimensions/${locationId}?error=${encodeURIComponent("You cannot archive records.")}`);
    await prisma.$transaction([
      prisma.location.update({
        where: { id: locationId },
        data: { isActive: false, archivedAt: new Date(), archivedById: user.id },
      }),
      prisma.storeProcess.updateMany({
        where: { locationId, status: "ACTIVE", suspended: false },
        data: { suspended: true, suspendedByArchive: true },
      }),
    ]);
    await enqueueRecordEvent({ event: "record.archived", locationId, actorName: user.name });
    revalidatePath("/dimensions");
    revalidatePath("/dashboard");
    redirect(`/dimensions/${locationId}`);
  });
}

/** Restores an archived record and resumes the workflows that archiving paused. */
export async function restoreRecord(formData: FormData) {
  const locationId = String(formData.get("locationId") ?? "");
  return audited("records.restore", [formData], async () => {
    const { user, access } = await actor();
    if (!canEditModule(access, "STORES")) redirect(`/dimensions/${locationId}?error=${encodeURIComponent("You cannot restore records.")}`);
    const location = await prisma.location.findUnique({ where: { id: locationId }, include: { values: true } });
    if (!location) redirect("/dimensions/archived");
    // A record archived long ago may share its identifier with one created since.
    const keyFields = await prisma.fieldDefinition.findMany({
      where: { isStoreKey: true, category: { recordTypeId: location.recordTypeId } },
      select: { id: true, friendlyName: true },
    });
    for (const field of keyFields) {
      const value = location.values.find((row) => row.fieldId === field.id)?.valueText?.trim();
      if (value && (await identifierTaken(prisma, field.id, value, locationId))) {
        redirect(`/dimensions/${locationId}?error=${encodeURIComponent(`Another record already uses this ${field.friendlyName}. Change one of them first.`)}`);
      }
    }
    await prisma.$transaction([
      prisma.location.update({ where: { id: locationId }, data: { isActive: true, archivedAt: null, archivedById: null } }),
      prisma.storeProcess.updateMany({
        where: { locationId, suspendedByArchive: true },
        data: { suspended: false, suspendedByArchive: false },
      }),
    ]);
    await enqueueRecordEvent({ event: "record.restored", locationId, actorName: user.name });
    revalidatePath("/dimensions");
    revalidatePath("/dimensions/archived");
    revalidatePath("/dashboard");
    redirect(`/dimensions/${locationId}`);
  });
}
