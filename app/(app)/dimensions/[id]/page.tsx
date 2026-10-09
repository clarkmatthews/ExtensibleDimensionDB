import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { StoreForm, type EditorCategory } from "@/components/store-form";
import { canEditModule, canSeeValue, canViewModule, categoryAccess, fieldAccess, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { loadFieldChoices } from "@/lib/list-items";
import { startWorkflow } from "@/lib/store-actions";
import { localDateInput, storedToInput } from "@/lib/values";

export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { task, error } = await searchParams;
  const location = await prisma.location.findUnique({ where: { id }, include: { values: true } });
  if (!location) notFound();
  const access = await loadAccess(user);
  if (!canViewModule(access, "STORES")) return <ModuleDenied />;
  const moduleEdit = canEditModule(access, "STORES");
  const highlight = new Set<string>();
  if (task) {
    const openTask = await prisma.task.findUnique({
      where: { id: task },
      include: { step: { include: { fields: true } } },
    });
    openTask?.step.fields.forEach((field) => highlight.add(field.fieldId));
  }
  const fields = await prisma.fieldDefinition.findMany({
    where: { isActive: true, category: { isActive: true } },
    include: { options: { orderBy: { sortOrder: "asc" } }, category: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  const choiceMeta = await loadFieldChoices(
    fields.map((field) => ({ id: field.id, choiceListId: field.choiceListId, parentFieldId: field.parentFieldId })),
    (parentId) => {
      const parent = fields.find((field) => field.id === parentId);
      if (!parent) return "";
      return storedToInput(parent, location.values.find((value) => value.fieldId === parent.id));
    },
  );
  const categories = new Map<string, EditorCategory>();
  let canUpdate = false;
  for (const field of fields) {
    const categoryRights = categoryAccess(access, field.categoryId);
    const rights = fieldAccess(access, field.id, field.categoryId);
    if (!categoryRights.canViewData || !rights.canView) continue;
    if (moduleEdit && rights.canUpdate && !field.isCreatedDate) canUpdate = true;
    const category = categories.get(field.categoryId) ?? {
      id: field.categoryId,
      name: field.category.name,
      description: field.category.description,
      fields: [],
    };
    const stored = location.values.find((value) => value.fieldId === field.id);
    const entered = storedToInput(field, stored);
    category.fields.push({
      id: field.id,
      friendlyName: field.friendlyName,
      description: field.description,
      dataType: field.dataType,
      formatExample: field.formatExample,
      canUpdate: moduleEdit && rights.canUpdate && !field.isCreatedDate,
      isRequired: field.isRequired,
      checkboxLabel: field.checkboxLabel,
      multiple: field.multiple,
      numVisible: field.numVisible,
      value: field.isCreatedDate ? entered || localDateInput(location.createdAt) : entered,
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
      highlighted: highlight.has(field.id),
    });
    categories.set(field.categoryId, category);
  }
  const [changes, manualProcesses] = await Promise.all([
    prisma.fieldChange.findMany({
      where: { locationId: location.id },
      include: { field: { include: { category: true } }, user: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.workflowProcess.findMany({
      where: { isActive: true, manual: true, kind: "TASK" },
      orderBy: { name: "asc" },
    }),
  ]);
  const visibleChanges = changes.filter((row) => canSeeValue(access, row.fieldId, row.field.categoryId));

  return (
    <div className="space-y-4">
      <h1 className="flex items-center text-2xl font-semibold">
        Dimension
        <HelpTip text="Edit the values for this record. An attribute's description appears beside it. Attributes you cannot update are read only. When you open this page from an action, the attributes that step requires are highlighted. Changelog lists saved edits for this record." />
      </h1>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      <StoreForm locationId={location.id} categories={[...categories.values()]} readOnly={!canUpdate} />
      {canUpdate && manualProcesses.length ? (
        <form action={startWorkflow} className="panel flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="locationId" value={location.id} />
          <label>
            <span className="label">Start workflow <HelpTip text="Starts an action sequence that allows a manual start. A workflow that is already open for this record is left as it is." /></span>
            <select className="field" name="processId" required>
              {manualProcesses.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}
            </select>
          </label>
          <button className="btn" type="submit">Start</button>
        </form>
      ) : null}
      <section className="space-y-2">
        <h2 className="flex items-center text-lg font-semibold">
          Changelog
          <HelpTip text="Saved edits for this record, newest first. The full log is on Changelog." />
        </h2>
        {visibleChanges.length === 0 ? <p className="text-sm text-muted">No edits yet.</p> : null}
        {visibleChanges.map((row) => (
          <article key={row.id} className="panel px-4 py-3 text-sm">
            <p>{row.field.category.name} · {row.field.friendlyName}</p>
            <p className="mt-1"><span className="text-muted">{row.oldValue || "blank"}</span>{" → "}{row.newValue || "blank"}</p>
            <p className="mt-1 text-xs text-muted">{row.user.name} · {row.createdAt.toLocaleString()}</p>
          </article>
        ))}
        <p className="text-sm">
          <Link className="font-semibold text-pine" href="/changelog">Open Changelog</Link>
        </p>
      </section>
    </div>
  );
}
