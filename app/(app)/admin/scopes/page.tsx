import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { ScopeRuleForm, type ScopeRecordRule, type ScopeRuleField, type ScopeRuleRecord } from "@/components/scope-rule-form";
import { recordLabels } from "@/lib/record-types";
import { deleteScope, deleteScopeRule, saveScope, setScopeActive } from "@/lib/scope-actions";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SCOPE_ATTRIBUTE_TYPES } from "@/lib/row-scope";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Scopes" };

const SAVED: Record<string, string> = {
  scope: "Scope saved.",
  rule: "Rule saved.",
  deleted: "Scope deleted.",
};

export default async function ScopesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; open?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "ACCESS")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "ACCESS");
  const params = await searchParams;
  const [scopes, types, fieldRows, groups, people] = await Promise.all([
    prisma.scope.findMany({
      orderBy: { name: "asc" },
      include: {
        assignments: true,
        rules: {
          orderBy: { id: "asc" },
          include: {
            recordType: { select: { name: true } },
            field: { select: { friendlyName: true, dataType: true, isActive: true, category: { select: { isActive: true } } } },
            sourceRule: { select: { id: true, recordType: { select: { name: true } } } },
            records: { select: { locationId: true } },
            values: { select: { valueText: true }, orderBy: { valueText: "asc" } },
          },
        },
      },
    }),
    prisma.recordType.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.fieldDefinition.findMany({
      where: { isActive: true, dataType: { in: [...SCOPE_ATTRIBUTE_TYPES] }, category: { isActive: true } },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: {
        id: true,
        friendlyName: true,
        dataType: true,
        linkTypeId: true,
        category: { select: { name: true, recordTypeId: true } },
        options: { orderBy: { sortOrder: "asc" }, select: { value: true, label: true } },
      },
    }),
    prisma.group.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const groupName = new Map(groups.map((group) => [group.id, group.name]));
  const personName = new Map(people.map((person) => [person.id, person.name]));
  // Only the records rules already name are loaded; the rule form searches for others.
  const linkFields = new Map(fieldRows.filter((field) => field.dataType === "RECORD_LINK").map((field) => [field.id, field.linkTypeId ?? ""]));
  const named = scopes.flatMap((scope) =>
    scope.rules.flatMap((rule) => [
      ...rule.records.map((row) => ({ id: row.locationId, recordTypeId: rule.recordTypeId })),
      ...(rule.fieldId && linkFields.has(rule.fieldId) ? rule.values.map((row) => ({ id: row.valueText, recordTypeId: linkFields.get(rule.fieldId!)! })) : []),
    ]),
  );
  const recordLabel = await recordLabels(named.map((row) => row.id));
  const records: ScopeRuleRecord[] = [...new Map(named.map((row) => [row.id, { id: row.id, recordTypeId: row.recordTypeId, label: recordLabel.get(row.id) ?? row.id }])).values()];
  /** Why a rule matches nothing, or is worth a second look. Null when it is fine. */
  const ruleProblem = (rule: (typeof scopes)[number]["rules"][number]) => {
    if (rule.kind === "RECORDS") return rule.records.length ? null : { serious: true, text: "Matches no records: the records it listed were deleted. People with this scope see no rows of this type." };
    if (!rule.field) return { serious: true, text: "Matches no records: its attribute was deleted. People with this scope see no rows of this type. Edit it to pick another attribute, or delete it." };
    if (!rule.values.length && !rule.sourceRule) return { serious: true, text: "Matches no records: it has no values left and its record list was deleted. People with this scope see no rows of this type." };
    if (!rule.field.isActive || !rule.field.category.isActive) return { serious: false, text: "Its attribute is turned off. The rule still matches the values already stored, but nobody can change them." };
    return null;
  };
  const brokenCount = (scope: (typeof scopes)[number]) => scope.rules.filter((rule) => ruleProblem(rule)?.serious).length;
  const brokenScopes = scopes.filter((scope) => scope.isActive && brokenCount(scope) > 0);
  const fields: ScopeRuleField[] = fieldRows.map((field) => ({
    id: field.id,
    recordTypeId: field.category.recordTypeId,
    name: `${field.category.name}: ${field.friendlyName}`,
    dataType: field.dataType,
    linkTypeId: field.linkTypeId,
    options: field.options.map((option) => ({ value: option.value, label: option.label })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Scopes
          <HelpTip text="A scope limits which records someone can see. It only affects the record types it has rules for, so a location scope does not hide vendors. People with no scope still see every record their attributes allow. Assign a scope on a group or on a person's page." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          A scope limits rows, not attributes. Attribute permissions still decide view and edit. A record type with no rule stays fully visible. Someone in several scopes sees the combined rows. Assign scopes on{" "}
          <Link className="font-semibold text-pine" href="/admin/access">Groups</Link> or on a person&apos;s page.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {SAVED[params.saved ?? ""] ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">{SAVED[params.saved ?? ""]}</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view scopes. Edit access to Groups is required to change them.</p> : null}
      {brokenScopes.length ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm" role="status">
          {brokenScopes.length === 1 ? "1 scope has" : `${brokenScopes.length} scopes have`} a rule that matches no records, so the people it applies to see no rows of that record type:{" "}
          {brokenScopes.map((scope) => scope.name).join(", ")}.
        </p>
      ) : null}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-3 border-0 p-0">
        {canEdit ? <form action={saveScope} className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
          <input className="field" name="name" placeholder="New scope name" required />
          <input className="field" name="description" placeholder="Description" />
          <button className="btn" type="submit">Add scope</button>
        </form> : null}
        {scopes.map((scope) => {
          const recordRules: ScopeRecordRule[] = scope.rules
            .filter((rule) => rule.kind === "RECORDS")
            .map((rule) => ({ id: rule.id, recordTypeId: rule.recordTypeId, label: `${rule.recordType.name} (${rule.records.length})` }));
          const assigned = scope.assignments.map((row) => (row.subjectType === "GROUP" ? groupName.get(row.subjectId) : personName.get(row.subjectId)) ?? "Unknown");
          return (
            <details key={scope.id} id={`scope-${scope.id}`} open={params.open === scope.id} className="panel p-3">
              <summary className="cursor-pointer">
                <span className="font-semibold">{scope.name}</span>
                {scope.isActive ? null : <span className="ml-2 text-sm text-muted">(disabled)</span>}
                <span className="ml-2 text-sm text-muted">
                  {scope.rules.length === 1 ? "1 rule" : `${scope.rules.length} rules`} · {assigned.length === 1 ? "1 assignment" : `${assigned.length} assignments`}
                </span>
                {brokenCount(scope) ? (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    {brokenCount(scope) === 1 ? "1 rule matches nothing" : `${brokenCount(scope)} rules match nothing`}
                  </span>
                ) : null}
              </summary>
              <div className="mt-3 space-y-4">
                <form action={saveScope} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <input type="hidden" name="id" value={scope.id} />
                  <input className="field" name="name" defaultValue={scope.name} aria-label="Scope name" required />
                  <input className="field" name="description" defaultValue={scope.description} aria-label="Description" />
                  <button className="btn-quiet" type="submit">Save name</button>
                </form>
                <div className="flex flex-wrap gap-2">
                  <form action={setScopeActive}>
                    <input type="hidden" name="id" value={scope.id} />
                    <input type="hidden" name="active" value={scope.isActive ? "0" : "1"} />
                    <button className="btn-quiet" type="submit">{scope.isActive ? "Disable" : "Enable"}</button>
                  </form>
                  <form action={deleteScope}>
                    <input type="hidden" name="id" value={scope.id} />
                    <button className="btn-quiet" type="submit">Delete scope</button>
                  </form>
                </div>
                <p className="text-sm">
                  <span className="font-semibold">Assigned to: </span>
                  {assigned.length ? assigned.join(", ") : <span className="text-muted">no one yet</span>}
                </p>
                {scope.description ? <p className="text-sm text-muted">{scope.description}</p> : null}
                <div className="space-y-3">
                  {scope.rules.map((rule) => {
                    const names = rule.records.map((row) => recordLabel.get(row.locationId) ?? row.locationId);
                    const valueLabels = rule.field?.dataType === "RECORD_LINK"
                      ? rule.values.map((row) => recordLabel.get(row.valueText) ?? row.valueText)
                      : rule.values.map((row) => row.valueText);
                    const summary = rule.kind === "RECORDS"
                      ? `${rule.recordType.name}: ${names.join(", ") || "no records"}`
                      : `${rule.recordType.name} where ${rule.field?.friendlyName ?? "attribute"} is ${[rule.sourceRule ? `the records in ${rule.sourceRule.recordType.name}` : "", valueLabels.join(", ")].filter(Boolean).join(", or ") || "nothing"}`;
                    const problem = ruleProblem(rule);
                    return (
                      <div key={rule.id} className="space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                          <div>
                            <p>{summary}</p>
                            {problem ? <p className={`mt-1 text-xs ${problem.serious ? "font-semibold text-danger" : "text-muted"}`}>{problem.text}</p> : null}
                          </div>
                          <form action={deleteScopeRule}>
                            <input type="hidden" name="scopeId" value={scope.id} />
                            <input type="hidden" name="ruleId" value={rule.id} />
                            <button className="btn-quiet" type="submit">Delete rule</button>
                          </form>
                        </div>
                        {canEdit ? <details>
                          <summary className="cursor-pointer text-sm font-semibold text-pine">Edit rule</summary>
                          <div className="mt-2">
                            <ScopeRuleForm
                              key={`${rule.id}:${rule.kind}:${rule.fieldId ?? ""}:${rule.sourceRuleId ?? ""}:${rule.records.map((row) => row.locationId).join(",")}:${rule.values.map((row) => row.valueText).join(",")}`}
                              scopeId={scope.id}
                              types={types}
                              fields={fields}
                              chosenRecords={records}
                              recordRules={recordRules.filter((item) => item.id !== rule.id)}
                              initial={{
                                id: rule.id,
                                recordTypeId: rule.recordTypeId,
                                kind: rule.kind,
                                fieldId: rule.fieldId ?? "",
                                sourceRuleId: rule.sourceRuleId ?? "",
                                recordIds: rule.records.map((row) => row.locationId),
                                values: rule.values.map((row) => row.valueText),
                              }}
                            />
                          </div>
                        </details> : null}
                      </div>
                    );
                  })}
                </div>
                {canEdit ? (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Add a rule</h3>
                    {/* Keyed by the rules, so the form starts empty again after a rule is added. */}
                    <ScopeRuleForm key={`add-${scope.rules.map((rule) => rule.id).join(",")}`} scopeId={scope.id} types={types} fields={fields} recordRules={recordRules} />
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
      </fieldset>
    </div>
  );
}
