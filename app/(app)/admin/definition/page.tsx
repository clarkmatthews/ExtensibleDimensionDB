import Link from "next/link";
import { ConfirmDelete } from "@/components/confirm-delete";
import { FieldForm, type FieldDraft, type FieldListChoice } from "@/components/field-form";
import { HelpTip } from "@/components/help-tip";
import type { ListPeer } from "@/components/list-config-dialog";
import { ModuleDenied } from "@/components/module-denied";
import {
  deleteCategory,
  deleteField,
  deleteRecordType,
  moveCategory,
  moveField,
  previewCategoryDelete,
  previewFieldDelete,
  previewRecordTypeDelete,
  saveCategory,
  saveRecordType,
  setFieldActive,
  setRecordTypeActive,
} from "@/lib/definition-actions";
import { canEditModule, canViewModule, categoryAccess, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import type { DataTypeName } from "@/lib/validators";
import { redirect } from "next/navigation";

export default async function DefinitionPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string; category?: string; error?: string; saved?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const error = params.error;
  const access = await loadAccess(user);
  if (!canViewModule(access, "DEFINITION")) return <ModuleDenied />;
  const moduleEdit = canEditModule(access, "DEFINITION");
  const canManageLists = canEditModule(access, "LISTS");
  const recordTypes = await prisma.recordType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const activeTypes = recordTypes.filter((type) => type.isActive);
  const categories = await prisma.category.findMany({
    orderBy: [{ recordType: { sortOrder: "asc" } }, { sortOrder: "asc" }],
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
  const typeOptions = recordTypes.map((type) => ({ id: type.id, name: type.name }));
  // A list can only follow another attribute of the same record type.
  const followFieldsFor = (recordTypeId: string): ListPeer[] =>
    categories.filter((category) => category.recordTypeId === recordTypeId).flatMap((category) =>
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
      {params.saved === "type" ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">Record types saved.</p> : null}
      <section className="panel p-4">
        <details>
          <summary className="section-toggle flex cursor-pointer items-center gap-2 font-semibold">
            <span className="mark" aria-hidden="true" />
            Record types
            <HelpTip text="A record type is a kind of record, such as Location, Vendor, or Product. Each type has its own dimensions, attributes, unique identifier, and records, and its own tab on the Dimension page. A Link to record attribute connects records of different types. Delete removes the type, its dimensions, its records, and its attribute definitions, including attributes that follow them." />
          </summary>
          <div className="mt-4 space-y-3">
            {recordTypes.map((type) => (
              <div key={type.id} className="flex flex-wrap items-end gap-3">
                <form action={saveRecordType} className="flex flex-1 flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={type.id} />
                  <label>
                    <span className="label">Name</span>
                    <input className="field" name="name" defaultValue={type.name} disabled={!moduleEdit} />
                  </label>
                  <label className="flex-1">
                    <span className="label">Description</span>
                    <input className="field" name="description" defaultValue={type.description} disabled={!moduleEdit} />
                  </label>
                  {moduleEdit ? <button className="btn-quiet" type="submit">Save</button> : null}
                </form>
                {moduleEdit ? (
                  <span className="flex gap-2">
                    <form action={setRecordTypeActive}>
                      <input type="hidden" name="id" value={type.id} />
                      <input type="hidden" name="active" value={type.isActive ? "0" : "1"} />
                      <button className="btn-quiet" type="submit">{type.isActive ? "Hide" : "Show"}</button>
                    </form>
                    <ConfirmDelete id={type.id} preview={previewRecordTypeDelete} commit={deleteRecordType} />
                  </span>
                ) : null}
              </div>
            ))}
            {moduleEdit ? (
              <form action={saveRecordType} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
                <label>
                  <span className="label">New record type</span>
                  <input className="field" name="name" required placeholder="Vendor" />
                </label>
                <label className="flex-1">
                  <span className="label">Description</span>
                  <input className="field" name="description" />
                </label>
                <button className="btn" type="submit">Add record type</button>
              </form>
            ) : null}
          </div>
        </details>
      </section>
      {params.added ? (
        <div className="panel px-4 py-3 text-sm">
          Attribute added. Set which groups can see and update it on{" "}
          <Link className="font-semibold text-pine" href="/admin/access">
            Groups
          </Link>{" "}
          and attach it to a step on{" "}
          <Link className="font-semibold text-pine" href="/admin/workflows">
            Workflows
          </Link>
          .
        </div>
      ) : null}
      {canCreate ? (
        <form action={saveCategory} className={`panel grid gap-3 p-4 ${activeTypes.length > 1 ? "md:grid-cols-[auto_1fr_1fr_auto]" : "md:grid-cols-[1fr_1fr_auto]"}`}>
          {activeTypes.length > 1 ? (
            <label>
              <span className="label">Record type</span>
              <select className="field" name="recordTypeId" defaultValue={activeTypes[0]?.id}>
                {activeTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </label>
          ) : (
            <input type="hidden" name="recordTypeId" value={activeTypes[0]?.id ?? ""} />
          )}
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
      {categories.map((category, overall) => {
        const siblings = categories.filter((item) => item.recordTypeId === category.recordTypeId);
        const index = siblings.findIndex((item) => item.id === category.id);
        const typeName = recordTypes.find((type) => type.id === category.recordTypeId)?.name ?? "";
        const startsType = overall === 0 || categories[overall - 1].recordTypeId !== category.recordTypeId;
        const rights = categoryAccess(access, category.id);
        const canEditCategory = moduleEdit && (user.isAdmin || rights.canEditCategory);
        const canAdd = moduleEdit && (user.isAdmin || rights.canAddFields);
        const canEditFields = moduleEdit && (user.isAdmin || rights.canEditFields);
        return (
          <div key={category.id} className="space-y-2">
          {startsType && recordTypes.length > 1 ? <h2 className="pt-2 text-lg font-semibold">{typeName}</h2> : null}
          <section className="panel overflow-hidden">
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
                {canEditCategory && index < siblings.length - 1 ? (
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
                linkTypeId: field.linkTypeId ?? "",
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
                    <FieldForm categoryId={category.id} initial={draft} lists={followFieldsFor(category.recordTypeId)} catalogs={catalogs} canManageLists={canManageLists} recordTypes={typeOptions} />
                  ) : null}
                </div>
              );
            })}
            {canAdd ? (
              <div className="p-4">
                <h3 className="mb-2 text-sm font-semibold">Add attribute</h3>
                <div className="rounded-lg border border-line">
                  <FieldForm categoryId={category.id} lists={followFieldsFor(category.recordTypeId)} catalogs={catalogs} canManageLists={canManageLists} recordTypes={typeOptions} />
                </div>
              </div>
            ) : null}
            </div>
            </details>
          </section>
          </div>
        );
      })}
    </div>
  );
}
