"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { audited } from "@/lib/audit";
import { MAX_IMPORT_BYTES, previewImport, rowsToApply, type ApplyResult, type ImportSummary } from "@/lib/import";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadSaveContext, saveRecord } from "@/lib/record-save";
import { rightsForType } from "@/lib/record-access";
import { resolveRecordType } from "@/lib/record-types";
import { getCurrentUser } from "@/lib/session";
import { enqueueRecordEvent } from "@/lib/webhooks";
import { runWorkflows } from "@/lib/workflow";

const PAGE = "/dimensions/import";

async function importer() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canEditModule(access, "IMPORT") || !canEditModule(access, "STORES")) {
    redirect(`${PAGE}?error=${encodeURIComponent("Importing needs edit access to Import and to Dimension.")}`);
  }
  return { user, access };
}

/** Stores the uploaded file and its validation preview. Nothing is written to records yet. */
export async function uploadImport(formData: FormData) {
  const { user, access } = await importer();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`${PAGE}?error=${encodeURIComponent("Choose a CSV file.")}`);
  if (file.size > MAX_IMPORT_BYTES) redirect(`${PAGE}?error=${encodeURIComponent("The file is larger than 5 MB.")}`);
  const recordType = (await resolveRecordType(String(formData.get("recordTypeId") ?? ""))).current;
  if (!recordType) redirect(`${PAGE}?error=${encodeURIComponent("Choose a record type.")}`);
  if (!(await rightsForType(access, recordType.id)).canAdd) redirect(`${PAGE}?error=${encodeURIComponent("You cannot add records of this type.")}`);
  const csv = await file.text();
  const summary = await previewImport(csv, await loadSaveContext(recordType.id), access);
  const job = await prisma.importJob.create({
    data: {
      userId: user.id,
      recordTypeId: recordType.id,
      fileName: file.name.slice(0, 200),
      csv,
      summary: summary as unknown as Prisma.InputJsonValue,
    },
  });
  redirect(`${PAGE}?job=${job.id}`);
}

/** Applies a previewed file. Rows that failed validation are skipped; the rest are saved one by one. */
export async function applyImport(formData: FormData) {
  return audited("import.apply", [formData], async () => {
    const { user, access } = await importer();
    const jobId = String(formData.get("job") ?? "");
    const runRecordWorkflows = formData.get("runWorkflows") === "on";
    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== user.id) redirect(`${PAGE}?error=${encodeURIComponent("That import was not found. Upload the file again.")}`);
    if (!(await rightsForType(access, job.recordTypeId)).canAdd) redirect(`${PAGE}?error=${encodeURIComponent("You cannot add records of this type.")}`);
    // Claim the job so a double click cannot apply it twice.
    const claimed = await prisma.importJob.updateMany({ where: { id: job.id, status: "PREVIEWED" }, data: { status: "APPLYING" } });
    if (claimed.count === 0) redirect(`${PAGE}?job=${job.id}`);

    const ctx = await loadSaveContext(job.recordTypeId);
    const preview = job.summary as unknown as ImportSummary;
    const result: ApplyResult = { created: 0, updated: 0, unchanged: 0, failed: [] };
    if (!preview?.fatal) {
      for (const row of await rowsToApply(job.csv, ctx, access)) {
        if (row.messages.length) {
          result.failed.push({ row: row.row, message: row.messages[0] });
          continue;
        }
        const saved = await saveRecord({ ctx, access, userId: user.id, locationId: row.locationId, values: (field) => row.values.get(field.id) });
        if (saved.error !== undefined) {
          result.failed.push({ row: row.row, message: saved.error });
          continue;
        }
        if (saved.created) result.created += 1;
        else if (saved.changes.length) result.updated += 1;
        else result.unchanged += 1;
        if (!saved.changes.length && !saved.created) continue;
        if (runRecordWorkflows) {
          await runWorkflows({ locationId: saved.locationId, userId: user.id, userName: user.name, created: saved.created, changes: saved.changes });
        }
        await enqueueRecordEvent({
          event: saved.created ? "record.created" : "record.updated",
          locationId: saved.locationId,
          actorName: user.name,
          changes: saved.changes,
        });
      }
    }
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "APPLIED",
        appliedAt: new Date(),
        summary: { ...(preview as object), result } as unknown as Prisma.InputJsonValue,
        // The file is no longer needed once it has been applied.
        csv: "",
      },
    });
    revalidatePath("/dimensions");
    revalidatePath("/changelog");
    revalidatePath("/dashboard");
    redirect(`${PAGE}?job=${job.id}`);
  });
}
