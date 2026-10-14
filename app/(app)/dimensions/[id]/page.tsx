import Link from "next/link";
import { acceptedTypes } from "@/lib/files";
import { notFound, redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { StoreForm, type EditorCategory } from "@/components/store-form";
import { canEditModule, canSeeValue, canViewModule, categoryAccess, fieldAccess, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { recordTypeRights } from "@/lib/record-access";
import { linkedFrom, listRecordTypes, recordLabels, withLinkOptions } from "@/lib/record-types";
import { getCurrentUser } from "@/lib/session";
import { manualProcessesFor } from "@/lib/workflow";
import { loadFieldChoices } from "@/lib/list-items";
import { WatchToggle } from "@/components/watch-toggle";
import { ConfirmArchive } from "@/components/confirm-archive";
import { restoreRecord, startWorkflow } from "@/lib/store-actions";
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
  const typeRights = await recordTypeRights(access);
  const ownType = typeRights.get(location.recordTypeId);
  // A record whose type shows this person no attributes is not theirs to open.
  if (!ownType?.canView) return <ModuleDenied />;
  // Archiving and restoring need the same right as adding records of this type.
  const canArchive = ownType.canAdd;
  const [recordLabel, openWorkflows] = canArchive && location.isActive
    ? await Promise.all([
        recordLabels([location.id]).then((labels) => labels.get(location.id) ?? "this record"),
        prisma.storeProcess.count({ where: { locationId: location.id, status: "ACTIVE", suspended: false } }),
      ])
    : ["this record", 0];
  const moduleEdit = canEditModule(access, "STORES");
  const archived = !location.isActive;
  const archivedBy = location.archivedById
    ? (await prisma.user.findUnique({ where: { id: location.archivedById }, select: { name: true } }))?.name ?? ""
    : "";
  const highlight = new Set<string>();
  if (task) {
    const openTask = await prisma.task.findUnique({
      where: { id: task },
      include: { step: { include: { fields: true } } },
    });
    openTask?.step.fields.forEach((field) => highlight.add(field.fieldId));
  }
  const linked = await withLinkOptions(
    await prisma.fieldDefinition.findMany({
      where: { isActive: true, category: { isActive: true, recordTypeId: location.recordTypeId } },
      include: { options: { orderBy: { sortOrder: "asc" } }, category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
  );
  // Keep links to records that were archived since, so saving the form does not drop them.
  const staleIds = linked.flatMap((field) => {
    if (field.dataType !== "RECORD_LINK") return [];
    const known = new Set(field.options.map((option) => option.value));
    const stored = location.values.find((value) => value.fieldId === field.id)?.valueText ?? "";
    return stored.split("|").filter((id) => id && !known.has(id));
  });
  const staleLabels = await recordLabels(staleIds);
  const fields = linked.map((field) => {
    if (field.dataType !== "RECORD_LINK") return field;
    const known = new Set(field.options.map((option) => option.value));
    const stored = (location.values.find((value) => value.fieldId === field.id)?.valueText ?? "").split("|").filter(Boolean);
    const extra = stored
      .filter((id) => !known.has(id))
      .map((id, index) => ({ ...field.options[0], id: `stale-${id}`, fieldId: field.id, value: id, label: `${staleLabels.get(id) ?? id} (archived)`, parentValues: "", isDefault: false, sortOrder: -1 - index }));
    return extra.length ? { ...field, options: [...extra, ...field.options] } : field;
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
      accept: field.dataType === "FILE" ? acceptedTypes(field).join(",") : undefined,
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
    manualProcessesFor(location.recordTypeId),
  ]);
  const [allTypes, inbound, watchers] = await Promise.all([
    listRecordTypes(),
    linkedFrom(location.id),
    prisma.recordWatch.findMany({ where: { locationId: location.id }, select: { userId: true } }),
  ]);
  const watching = watchers.some((row) => row.userId === user.id);
  const watcherCount = watchers.length;
  const types = allTypes.filter((type) => typeRights.get(type.id)?.canView);
  const recordType = types.find((type) => type.id === location.recordTypeId);
  const visibleInbound = inbound.filter((link) => canSeeValue(access, link.fieldId, link.categoryId));
  const visibleChanges = changes.filter((row) => canSeeValue(access, row.fieldId, row.field.categoryId));

  // Back to the list this record belongs in: its record type's tab, or the archive.
  const listName = types.length > 1 && recordType ? recordType.name : "Dimension";
  const back = archived
    ? { href: "/dimensions/archived", label: "Archived records" }
    : { href: types.length > 1 ? `/dimensions?type=${encodeURIComponent(location.recordTypeId)}` : "/dimensions", label: listName };

  return (
    <div className="space-y-4">
      <Link className="inline-flex items-center gap-1 text-sm font-medium text-pine hover:underline" href={back.href}>
        <span aria-hidden="true">←</span> {back.label}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center text-2xl font-semibold">
          {listName}
          <HelpTip text="Edit the values for this record. An attribute's description appears beside it. Attributes you cannot update are read only. When you open this page from an action, the attributes that step requires are highlighted. Changelog lists saved edits for this record." />
        </h1>
        <WatchToggle locationId={location.id} watching={watching} watcherCount={watcherCount} />
      </div>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {archived ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-warn">
          <span>
            Archived {location.archivedAt?.toLocaleString() ?? ""}{archivedBy ? ` by ${archivedBy}` : ""}. It is hidden from the grid, exports, the share API, and AI knowledge, and it cannot be edited.
          </span>
          {canArchive ? (
            <form action={restoreRecord}>
              <input type="hidden" name="locationId" value={location.id} />
              <button className="btn-quiet" type="submit">Restore</button>
            </form>
          ) : null}
        </div>
      ) : null}
      <StoreForm locationId={location.id} categories={[...categories.values()]} readOnly={!canUpdate || archived} />
      {!archived && canArchive ? (
        <ConfirmArchive locationId={location.id} label={recordLabel} openWorkflows={openWorkflows} />
      ) : null}
      {!archived && canUpdate && manualProcesses.length ? (
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
      {visibleInbound.length ? (
        <section className="space-y-2">
          <h2 className="flex items-center text-lg font-semibold">
            Linked from
            <HelpTip text="Other records whose link attributes point to this record." />
          </h2>
          <ul className="panel divide-y text-sm">
            {visibleInbound.map((link) => (
              <li key={`${link.locationId}-${link.fieldId}`} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <a className="font-semibold text-pine" href={`/dimensions/${link.locationId}`}>{link.label}</a>
                <span className="text-muted">{link.recordType} · {link.attribute}</span>
              </li>
            ))}
          </ul>
        </section>
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
            <p className="mt-1 text-xs text-muted">
              {row.user.name} · {row.createdAt.toLocaleString()}
              {row.proposalId ? " · from an approved AI proposal" : ""}
            </p>
          </article>
        ))}
        <p className="text-sm">
          <Link className="font-semibold text-pine" href="/changelog">Open Changelog</Link>
        </p>
      </section>
    </div>
  );
}
