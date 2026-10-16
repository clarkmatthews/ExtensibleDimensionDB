import Link from "next/link";
import { acceptedTypes } from "@/lib/files";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { StoreForm, type EditorCategory } from "@/components/store-form";
import { canEditModule, categoryAccess, fieldAccess, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { resolveVisibleRecordType } from "@/lib/record-access";
import { withLinkOptions } from "@/lib/record-types";
import { getCurrentUser } from "@/lib/session";
import { loadFieldChoices } from "@/lib/list-items";
import { defaultInput, localDateInput } from "@/lib/values";

export default async function NewStorePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canEditModule(access, "STORES")) return <ModuleDenied />;
  const { types, current, rights } = await resolveVisibleRecordType(access, (await searchParams).type);
  if (!current) return <p className="text-sm text-muted">You do not have access to any record types.</p>;
  // Only someone who can fill in at least one attribute of this type can create its records.
  if (!rights.canAdd) return <ModuleDenied />;
  // A scope that limits this type only lets new records in through an attribute rule.
  if (!rights.canCreate) {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm">
        Your scope does not let you add {current.name} records. It only includes specific existing records. Ask an administrator if you need to add one.
      </p>
    );
  }
  const fields = await withLinkOptions(
    await prisma.fieldDefinition.findMany({
      where: { isActive: true, category: { isActive: true, recordTypeId: current.id } },
      include: { options: { orderBy: { sortOrder: "asc" } }, category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
    access,
  );
  const choiceMeta = await loadFieldChoices(
    fields.map((field) => ({ id: field.id, choiceListId: field.choiceListId, parentFieldId: field.parentFieldId })),
    (parentId) => {
      const parent = fields.find((field) => field.id === parentId);
      return parent ? defaultInput(parent) : "";
    },
  );
  const categories = new Map<string, EditorCategory>();
  let canUpdate = false;
  for (const field of fields) {
    const categoryRights = categoryAccess(access, field.categoryId);
    const rights = fieldAccess(access, field.id, field.categoryId);
    if (!categoryRights.canViewData || !rights.canView) continue;
    if (rights.canUpdate && !field.isCreatedDate) canUpdate = true;
    const category = categories.get(field.categoryId) ?? {
      id: field.categoryId,
      name: field.category.name,
      description: field.category.description,
      fields: [],
    };
    category.fields.push({
      id: field.id,
      friendlyName: field.friendlyName,
      description: field.description,
      dataType: field.dataType,
      formatExample: field.formatExample,
      canUpdate: rights.canUpdate && !field.isCreatedDate,
      isRequired: field.isRequired,
      checkboxLabel: field.checkboxLabel,
      accept: field.dataType === "FILE" ? acceptedTypes(field).join(",") : undefined,
      multiple: field.multiple,
      numVisible: field.numVisible,
      value: field.isCreatedDate ? localDateInput() : defaultInput(field),
      choiceSource: field.choiceSource,
      choiceListId: field.choiceListId ?? "",
      remote: choiceMeta.get(field.id)?.remote ?? false,
      parentFieldId: field.parentFieldId ?? "",
      options:
        (field.choiceListId ? choiceMeta.get(field.id)?.options : undefined)?.map((option) => ({
          label: option.label,
          value: option.value,
          parentValues: option.parentValues ?? "",
        })) ??
        field.options.map((option) => ({ label: option.label, value: option.value, parentValues: option.parentValues })),
      highlighted: false,
    });
    categories.set(field.categoryId, category);
  }
  return (
    <div className="space-y-4">
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-pine hover:underline"
        href={types.length > 1 ? `/dimensions?type=${encodeURIComponent(current.id)}` : "/dimensions"}
      >
        <span aria-hidden="true">←</span> {types.length > 1 ? current.name : "Dimension"}
      </Link>
      <h1 className="flex items-center text-2xl font-semibold">
        {types.length > 1 ? `New ${current.name}` : "New dimension"}
        <HelpTip text="Create a record from the attributes you can update. A date attribute set to fill from the record date shows today's date and stays read only. Saving starts workflows that run when a record is created." />
      </h1>
      {categories.size === 0 ? (
        <p className="text-sm text-muted">Add dimensions and attributes before creating a record.</p>
      ) : (
        <StoreForm recordTypeId={current.id} categories={[...categories.values()]} readOnly={!canUpdate} />
      )}
    </div>
  );
}
