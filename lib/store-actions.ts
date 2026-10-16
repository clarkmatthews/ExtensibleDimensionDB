"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audited } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { createHash } from "node:crypto";
import { extractFileText } from "@/lib/file-text";
import { cleanFileName, extensionOf, FILE_TYPES, fileToken, MAX_UPLOAD_BYTES, parseFileTokens, uploadError } from "@/lib/files";
import { canUpdateField, identifierTaken, loadSaveContext, saveRecord, storedInputs, type LoadedField } from "@/lib/record-save";
import { rightsForRecord, rightsForType } from "@/lib/record-access";
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
  const typeRights = await rightsForType(access, recordTypeId);
  if (locationId ? !typeRights.canView : !typeRights.canAdd) {
    return { error: locationId ? "You do not have access to this record." : "You cannot add records of this type." };
  }
  const submitted = (field: LoadedField) => {
    const values = formData.getAll(`field:${field.id}`).map(String);
    return field.multiple ? values.filter(Boolean).join("|") : (values[0] ?? "");
  };
  const ctx = await loadSaveContext(recordTypeId, access);
  const stored = locationId ? await storedInputs(locationId) : new Map<string, string>();
  const uploaded = await storeUploads(formData, ctx.fields.filter((field) => field.dataType === "FILE" && canUpdateField(access, field)), user.id);
  if ("error" in uploaded) return { error: uploaded.error };
  ctx.uploads = uploaded.tokens;
  // A file attribute's new value: the files it holds minus those marked for removal, plus new
  // uploads. A single-file attribute keeps only the newest upload.
  const fileValue = (field: LoadedField) => {
    if (formData.get(`files:${field.id}`) !== "1") return undefined;
    const removed = new Set(formData.getAll(`remove:${field.id}`).map(String));
    const kept = parseFileTokens(stored.get(field.id)).filter((file) => !removed.has(file.id)).map(fileToken);
    const added = uploaded.tokens.get(field.id) ?? [];
    return (field.multiple ? [...kept, ...added] : added.length ? added.slice(-1) : kept.slice(0, 1)).join("|");
  };
  const result = await saveRecord({
    ctx,
    access,
    userId: user.id,
    locationId,
    // The form posts every attribute the person can update. A missing checkbox or an empty
    // multiple choice is absent from the post, which means "cleared".
    values: (field) => (field.dataType === "FILE" ? fileValue(field) : submitted(field)),
    // A parent the person cannot edit is not posted, so its stored value decides the choices.
    parentValues: (field) => (field.dataType === "FILE" ? fileValue(field) : formData.has(`field:${field.id}`) ? submitted(field) : undefined),
  });
  if (result.error !== undefined) {
    // Nothing was saved, so the uploads are not attached to anything.
    const ids = [...uploaded.tokens.values()].flat().map((token) => parseFileTokens(token)[0].id);
    if (ids.length) await prisma.storedFile.deleteMany({ where: { id: { in: ids }, locationId: null } });
    return { error: result.error };
  }
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

/** Follow or stop following a record. Anyone who can open the record can watch it. */
export async function setRecordWatch(formData: FormData) {
  const { user, access } = await actor();
  const locationId = String(formData.get("locationId") ?? "");
  if (!(await rightsForRecord(access, locationId))?.canView) redirect("/dimensions");
  const key = { userId: user.id, locationId };
  if (formData.get("watch") === "1") {
    await prisma.recordWatch.upsert({ where: { userId_locationId: key }, update: {}, create: key });
  } else {
    await prisma.recordWatch.deleteMany({ where: key });
  }
  revalidatePath(`/dimensions/${locationId}`);
  revalidatePath("/dashboard");
}

/**
 * Stores the files posted for each file attribute this person can update. They are attached to
 * the record when the save succeeds; on any problem nothing is kept.
 */
async function storeUploads(formData: FormData, fields: LoadedField[], userId: string): Promise<{ error: string } | { tokens: Map<string, string[]> }> {
  const pending: { field: LoadedField; name: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  let total = 0;
  for (const field of fields) {
    for (const entry of formData.getAll(`upload:${field.id}`)) {
      if (typeof entry === "string" || entry.size === 0) continue;
      total += entry.size;
      if (total > MAX_UPLOAD_BYTES) return { error: `Upload at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB of files in one save.` };
      const bytes = new Uint8Array(await entry.arrayBuffer());
      const problem = uploadError(field, entry.name, bytes);
      if (problem) return { error: problem };
      pending.push({ field, name: cleanFileName(entry.name), bytes });
    }
  }
  const tokens = new Map<string, string[]>();
  for (const item of pending) {
    const saved = await prisma.storedFile.create({
      data: {
        fieldId: item.field.id,
        name: item.name,
        contentType: FILE_TYPES[extensionOf(item.name)] ?? "application/octet-stream",
        size: item.bytes.length,
        sha256: createHash("sha256").update(item.bytes).digest("hex"),
        data: item.bytes,
        // Read once now, so AI tools and search can use the text right away.
        ...(await extractFileText(item.name, item.bytes).then((result) => ("text" in result ? { text: result.text } : { textError: result.error }))),
        uploadedById: userId,
      },
      select: { id: true },
    });
    tokens.set(item.field.id, [...(tokens.get(item.field.id) ?? []), fileToken({ id: saved.id, name: item.name })]);
  }
  return { tokens };
}

export async function startWorkflow(formData: FormData) {
  const { user, access } = await actor();
  if (!canEditModule(access, "STORES")) redirect("/dimensions?error=You%20cannot%20change%20dimensions.");
  const locationId = String(formData.get("locationId") ?? "");
  const processId = String(formData.get("processId") ?? "");
  if (!(await rightsForRecord(access, locationId))?.canView) redirect("/dimensions");
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
    if (!(await rightsForRecord(access, locationId))?.canAdd) {
      redirect(`/dimensions/${locationId}?error=${encodeURIComponent("Archiving needs permission to add records of this type.")}`);
    }
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
    if (!(await rightsForRecord(access, locationId))?.canAdd) {
      redirect(`/dimensions/${locationId}?error=${encodeURIComponent("Restoring needs permission to add records of this type.")}`);
    }
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
