import { prisma } from "@/lib/prisma";
import { withLinkOptions } from "@/lib/record-types";
import { categoryAccess, fieldAccess, type AccessContext } from "@/lib/permissions";
import { storedToDisplay, storedToInput, type DefinedField } from "@/lib/values";

/** The attributes of one record type that this person may view, with link choices loaded. */
export async function loadVisibleFields(access: AccessContext, recordTypeId: string) {
  const fields = await withLinkOptions(
    await prisma.fieldDefinition.findMany({
      where: { isActive: true, category: { isActive: true, recordTypeId } },
      include: { options: { orderBy: { sortOrder: "asc" } }, category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
  );
  return fields.filter((field) => {
    const category = categoryAccess(access, field.categoryId);
    const rights = fieldAccess(access, field.id, field.categoryId);
    return category.canViewData && rights.canView;
  });
}

export async function loadStoreRows(fields: DefinedField[], query: string, recordTypeId: string) {
  const locations = await prisma.location.findMany({
    where: { isActive: true, recordTypeId },
    include: { values: true },
    orderBy: { createdAt: "desc" },
  });
  const needle = query.trim().toLowerCase();
  return locations
    .map((location) => {
      const values: Record<string, string> = {};
      for (const field of fields) {
        const stored = location.values.find((value) => value.fieldId === field.id);
        values[field.id] = storedToDisplay(field, stored);
      }
      return { id: location.id, values, haystack: Object.values(values).join(" ").toLowerCase() };
    })
    .filter((row) => !needle || row.haystack.includes(needle));
}

export function editorValue(field: DefinedField, stored: Parameters<typeof storedToInput>[1]) {
  return storedToInput(field, stored);
}
