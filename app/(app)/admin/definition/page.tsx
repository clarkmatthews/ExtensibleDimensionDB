import Link from "next/link";
import { ConfirmDelete } from "@/components/confirm-delete";
import { FieldForm, type FieldDraft, type FieldListChoice } from "@/components/field-form";
import { HelpTip } from "@/components/help-tip";
import type { ListPeer } from "@/components/list-config-dialog";
import { ModuleDenied } from "@/components/module-denied";
import {
  deleteCategory,
  deleteField,
  moveCategory,
  moveField,
  previewCategoryDelete,
  previewFieldDelete,
  saveCategory,
  setFieldActive,
} from "@/lib/definition-actions";
import { canEditModule, canViewModule, categoryAccess, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import type { DataTypeName } from "@/lib/validators";
import { redirect } from "next/navigation";

export default async function DefinitionPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string; category?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const error = params.error;
  const access = await loadAccess(user);
  if (!canViewModule(access, "DEFINITION")) return <ModuleDenied />;
  const moduleEdit = canEditModule(access, "DEFINITION");
  const canManageLists = canEditModule(access, "LISTS");
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      fields: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  const canCreate = moduleEdit;
  const [choiceLists, itemCounts] = await Promise.all([
    prisma.choiceList.findMany({
      orderBy: { name: "asc" },
      include: { parentList: { select: { name: true } } },
    }),
    prisma.choiceListItem.groupBy({
      by: ["listId"],
      where: { isActive: true },
      _count: { _all: true },
    }),
  ]);
  const countByList = new Map(itemCounts.map((row) => [row.listId, row._count._all]));
  const catalogs: FieldListChoice[] = choiceLists.map((list) => ({
    id: list.id,
    name: list.name,
    isActive: list.isActive,
    choiceSource: list.choiceSource,
    parentListId: list.parentListId ?? "",
    parentName: list.parentList?.name ?? "",
    itemCount: countByList.get(list.id) ?? 0,
  }));
  const followFields: ListPeer[] = categories.flatMap((category) =>
    category.fields
      .filter((item) => item.dataType === "DROPDOWN" || item.dataType === "RADIO")
      .map((item) => ({
        id: item.id,
        friendlyName: item.friendlyName,
        choiceSource: item.choiceSource,
        choiceListId: item.choiceListId ?? "",
        parentFieldId: item.parentFieldId ?? "",
        options: [],
      })),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Data definition
          <HelpTip text="Dimensions group attributes. Each attribute has a key, a display name, and the rules for what it accepts. Hide an attribute to take it off the dimension editor and keep its values. Delete removes the attribute, attributes that follow it, and the values stored on dimensions. Deleting a dimension does the same for every attribute in it. Up and Down change display order." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Each attribute has a key, a display name, and a description. Open an attribute to set what values it accepts, including a format example and a regular expression.
        </p>
      </div>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {params.added ? (
        <div className="panel px-4 py-3 text-sm">
          Attribute added. Set who can see and update it on{" "}
          <Link className="font-semibold text-pine" href="/admin/permissions">
            Permissions
          </Link>{" "}
          and attach it to a step on{" "}
          <Link className="font-semibold text-pine" href="/admin/workflows">
            Workflows
          </Link>
          .
        </div>
      ) : null}
      {canCreate ? (
        <form action={saveCategory} className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
          <label>
            <span className="label">New dimension</span>
            <input className="field" name="name" required />
          </label>
          <label>
            <span className="label">Description</span>
            <input className="field" name="description" />
          </label>
          <button className="btn self-end" type="submit">
            Add dimension
          </button>
        </form>
      ) : null}
      {categories.length === 0 ? (
        <p className="text-sm text-muted">No dimensions yet. Add one, then add attributes inside it.</p>
      ) : null}
      {categories.map((category, index) => {
        const rights = categoryAccess(access, category.id);
        const canEditCategory = moduleEdit && (user.isAdmin || rights.canEditCategory);
        const canAdd = moduleEdit && (user.isAdmin || rights.canAddFields);
        const canEditFields = moduleEdit && (user.isAdmin || rights.canEditFields);
        return (
          <section key={category.id} className="panel overflow-hidden">
            <details {...(params.category === category.id ? { open: true } : {})}>
            <summary className="section-toggle flex cursor-pointer items-center gap-2 px-4 py-3 text-lg font-semibold">
              <span className="mark" aria-hidden="true" />
              {category.name}
            </summary>
            <div className="border-t border-line">
            <div className="flex flex-wrap items-end gap-3 p-4">
              <form action={saveCategory} className="grid flex-1 gap-3 md:grid-cols-2">
                <input type="hidden" name="id" value={category.id} />
                <label>
                  <span className="label">Dimension name</span>
                  <input className="field" name="name" defaultValue={category.name} disabled={!canEditCategory} />
                </label>
                <label>
                  <span className="label">Description</span>
                  <input className="field" name="description" defaultValue={category.description} disabled={!canEditCategory} />
                </label>
                {canEditCategory ? (
                  <button className="btn w-fit" type="submit">
                    Save dimension
                  </button>
                ) : null}
              </form>
              <div className="flex gap-2">
                {canEditCategory && index > 0 ? (
                  <form action={moveCategory}>
                    <input type="hidden" name="id" value={category.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button className="btn-quiet" type="submit">Up</button>
                  </form>
                ) : null}
                {canEditCategory && index < categories.length - 1 ? (
                  <form action={moveCategory}>
                    <input type="hidden" name="id" value={category.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button className="btn-quiet" type="submit">Down</button>
                  </form>
                ) : null}
                {canCreate ? <ConfirmDelete id={category.id} preview={previewCategoryDelete} commit={deleteCategory} /> : null}
              </div>
            </div>
            {category.fields.map((field, fieldIndex) => {
              const draft: FieldDraft = {
                id: field.id,
                key: field.key,
                friendlyName: field.friendlyName,
                description: field.description,
                dataType: field.dataType as DataTypeName,
                isRequired: field.isRequired,
                isStoreKey: field.isStoreKey,
                isActiveFilter: field.isActiveFilter,
                isCreatedDate: field.isCreatedDate,
                choiceSource: field.choiceSource,
                choiceListId: field.choiceListId ?? "",
                parentFieldId: field.parentFieldId ?? "",
                defaultValue: field.defaultValue,
                formatExample: field.formatExample,
                validationPattern: field.validationPattern,
                useRegex: field.useRegex,
                maxLength: field.maxLength?.toString() ?? "",
                minValue: field.minValue?.toString() ?? "",
                maxValue: field.maxValue?.toString() ?? "",
                negativeOk: field.negativeOk,
                decimalOk: field.decimalOk,
                numVisible: String(field.numVisible),
                multiple: field.multiple,
                is24Hour: field.is24Hour,
                checkboxLabel: field.checkboxLabel,
                minDate: field.minDate,
                maxDate: field.maxDate,
                options: field.options.map((option) => ({
                  label: option.label,
                  value: option.value,
                  isDefault: option.isDefault,
                  parentValues: option.parentValues,
                })),
              };
              return (
                <div key={field.id}>
                  <div className="flex items-center justify-between gap-3 px-4 pt-3 text-sm">
                    <span className={field.isActive ? "" : "text-muted line-through"}>{field.friendlyName}</span>
                    <span className="flex gap-2">
                      {canEditCategory && fieldIndex > 0 ? (
                        <form action={moveField}>
                          <input type="hidden" name="id" value={field.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button className="btn-quiet" type="submit">Up</button>
                        </form>
                      ) : null}
                      {canEditCategory && fieldIndex < category.fields.length - 1 ? (
                        <form action={moveField}>
                          <input type="hidden" name="id" value={field.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button className="btn-quiet" type="submit">Down</button>
                        </form>
                      ) : null}
                      {(moduleEdit && (field.isActive ? user.isAdmin || rights.canRemoveFields : user.isAdmin || rights.canAddFields)) ? (
                        <form action={setFieldActive}>
                          <input type="hidden" name="id" value={field.id} />
                          <input type="hidden" name="active" value={field.isActive ? "0" : "1"} />
                          <button className="btn-quiet" type="submit">{field.isActive ? "Hide" : "Activate"}</button>
                        </form>
                      ) : null}
                      {moduleEdit && (user.isAdmin || rights.canRemoveFields) ? (
                        <ConfirmDelete id={field.id} preview={previewFieldDelete} commit={deleteField} />
                      ) : null}
                    </span>
                  </div>
                  {canEditFields ? (
                    <FieldForm categoryId={category.id} initial={draft} lists={followFields} catalogs={catalogs} canManageLists={canManageLists} />
                  ) : null}
                </div>
              );
            })}
            {canAdd ? (
              <div className="p-4">
                <h3 className="mb-2 text-sm font-semibold">Add attribute</h3>
                <div className="rounded-lg border border-line">
                  <FieldForm categoryId={category.id} lists={followFields} catalogs={catalogs} canManageLists={canManageLists} />
                </div>
              </div>
            ) : null}
            </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}
