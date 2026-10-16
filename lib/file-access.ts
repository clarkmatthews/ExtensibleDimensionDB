import { extractFileText } from "@/lib/file-text";
import { parseFileTokens } from "@/lib/files";
import { canSeeValue, type AccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { locationVisible } from "@/lib/row-scope";

/**
 * A stored file this person may open: it is attached to a record, still listed in that record's
 * value, and the person can view that attribute. With activeOnly, archived records are excluded.
 */
export async function visibleFile(access: AccessContext, id: string, options: { activeOnly?: boolean } = {}) {
  const file = await prisma.storedFile.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      size: true,
      fieldId: true,
      locationId: true,
      field: { select: { categoryId: true, friendlyName: true } },
      location: { select: { isActive: true } },
    },
  });
  if (!file?.locationId || !canSeeValue(access, file.fieldId, file.field.categoryId)) return null;
  if (!(await locationVisible(access, file.locationId))) return null;
  if (options.activeOnly && !file.location?.isActive) return null;
  const value = await prisma.fieldValue.findUnique({
    where: { locationId_fieldId: { locationId: file.locationId, fieldId: file.fieldId } },
    select: { valueText: true },
  });
  if (!parseFileTokens(value?.valueText).some((item) => item.id === file.id)) return null;
  return { ...file, locationId: file.locationId };
}

/** The file's text, extracted and saved the first time it is needed. */
export async function fileText(id: string): Promise<{ text: string } | { error: string }> {
  const stored = await prisma.storedFile.findUnique({ where: { id }, select: { text: true, textError: true, name: true } });
  if (!stored) return { error: "File not found." };
  if (stored.text != null) return { text: stored.text };
  if (stored.textError) return { error: stored.textError };
  const row = await prisma.storedFile.findUnique({ where: { id }, select: { data: true } });
  const extracted = await extractFileText(stored.name, new Uint8Array(row!.data));
  await prisma.storedFile.update({
    where: { id },
    data: "text" in extracted ? { text: extracted.text, textError: "" } : { text: null, textError: extracted.error },
  });
  return extracted;
}

/**
 * Reads the text of a few files that do not have it yet (uploaded before text was kept), so
 * search can find them. Called before searching; each call does a small, bounded amount of work.
 */
export async function catchUpFileText(fieldIds: string[], limit = 10) {
  const pending = await prisma.storedFile.findMany({
    where: { fieldId: { in: fieldIds }, locationId: { not: null }, text: null, textError: "" },
    select: { id: true },
    take: limit,
  });
  for (const file of pending) await fileText(file.id);
}
