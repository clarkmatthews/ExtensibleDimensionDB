import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { moveWorkflowStep, saveWorkflow, saveWorkflowStep } from "@/lib/access-actions";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Workflows" };

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "WORKFLOWS")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "WORKFLOWS");
  const params = await searchParams;
  const [processes, groups, categories, users] = await Promise.all([
    prisma.workflowProcess.findMany({
      orderBy: { name: "asc" },
      include: {
        steps: { orderBy: { sortOrder: "asc" }, include: { group: true, fields: true, assigneeUser: true } },
        categories: true,
        triggers: true,
        recipients: true,
      },
    }),
    prisma.group.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { fields: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
    }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { groups: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Workflows
          <HelpTip text="A workflow is either a notification or an action sequence. Record created, an attribute change, or a manual start can open it. A notification sends the previous value, the new value, who saved it, and when. An action sequence assigns steps to a group. Leave Dimensions empty to apply the workflow to every record." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Choose Notify to send the before and after values, or Action sequence to assign work. Triggers are record created, an attribute change, or a manual start from the record.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view workflows. Edit access is required to change them.</p> : null}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6 border-0 p-0">
        <form action={saveWorkflow} className="panel grid gap-3 p-4 md:grid-cols-2">
          <label>
            <span className="label">New workflow</span>
            <input className="field" name="name" placeholder="Name" required />
          </label>
          <label>
            <span className="label">Description</span>
            <input className="field" name="description" />
          </label>
          <label>
            <span className="label">Kind</span>
            <select className="field" name="kind" defaultValue="TASK">
              <option value="NOTIFY">Notify</option>
              <option value="TASK">Action sequence</option>
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input name="onCreate" type="checkbox" /> Record created</label>
            <label className="flex items-center gap-2"><input name="isActive" type="checkbox" defaultChecked /> Active</label>
            <button className="btn" type="submit">Add workflow</button>
          </div>
        </form>
        {processes.map((process) => (
          <section key={process.id} className="panel overflow-hidden">
            <details>
              <summary className="section-toggle flex cursor-pointer items-center gap-2 px-4 py-3 text-lg font-semibold">
                <span className="mark" aria-hidden="true" />
                {process.name}
                <span className="text-sm font-normal text-muted">{process.kind === "NOTIFY" ? "Notify" : "Action sequence"}{process.isActive ? "" : " · inactive"}</span>
              </summary>
              <div className="space-y-4 border-t border-line p-4">
                <form action={saveWorkflow} className="space-y-4">
                  <input type="hidden" name="id" value={process.id} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <label>
                      <span className="label">Name</span>
                      <input className="field" name="name" defaultValue={process.name} required />
                    </label>
                    <label>
                      <span className="label">Description</span>
                      <input className="field" name="description" defaultValue={process.description} />
                    </label>
                    <label>
                      <span className="label">Kind</span>
                      <select className="field" name="kind" defaultValue={process.kind}>
                        <option value="NOTIFY">Notify</option>
                        <option value="TASK">Action sequence</option>
                      </select>
                    </label>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <label className="flex items-center gap-2"><input name="isActive" type="checkbox" defaultChecked={process.isActive} /> Active</label>
                      <label className="flex items-center gap-2"><input name="onCreate" type="checkbox" defaultChecked={process.onCreate} /> Record created</label>
                      <label className="flex items-center gap-2"><input name="onChange" type="checkbox" defaultChecked={process.onChange} /> Attribute change</label>
                      {process.kind === "TASK" ? (
                        <label className="flex items-center gap-2"><input name="manual" type="checkbox" defaultChecked={process.manual} /> Manual start</label>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <p className="label">Dimensions <HelpTip text="Limit this workflow to records through these dimensions. Leave every box clear to apply it to every record." /></p>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      {categories.map((category) => (
                        <label key={category.id} className="flex items-center gap-2">
                          <input name="categoryId" type="checkbox" value={category.id} defaultChecked={process.categories.some((row) => row.categoryId === category.id)} />
                          {category.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="label">Attributes that start this workflow <HelpTip text="Used when Attribute change is checked, and listed on a Record created notice. A match value fires only when the new value is exactly that text, such as No." /></p>
                    <div className="mt-2 space-y-2">
                      {categories.map((category) => {
                        const selected = category.fields.some((field) => process.triggers.some((item) => item.fieldId === field.id));
                        return (
                          <details key={category.id} {...(selected ? { open: true } : {})}>
                            <summary className="section-toggle flex cursor-pointer items-center gap-2 text-sm font-semibold">
                              <span className="mark" aria-hidden="true" />
                              {category.name}
                            </summary>
                            <div className="mt-1 space-y-1 pl-7">
                              {category.fields.map((field) => {
                                const trigger = process.triggers.find((item) => item.fieldId === field.id);
                                return (
                                  <label key={field.id} className="flex flex-wrap items-center gap-2 text-sm">
                                    <input name="triggerFieldId" type="checkbox" value={field.id} defaultChecked={Boolean(trigger)} />
                                    <span className="w-40">{field.friendlyName}</span>
                                    <input className="field w-40" name={`match:${field.id}`} defaultValue={trigger?.matchValue ?? ""} placeholder="Any new value" />
                                  </label>
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                  {process.kind === "NOTIFY" ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="label">Groups to notify</p>
                        <div className="mt-2 space-y-1 text-sm">
                          {groups.map((group) => (
                            <label key={group.id} className="flex items-center gap-2">
                              <input name="recipientGroup" type="checkbox" value={group.id} defaultChecked={process.recipients.some((row) => row.groupId === group.id)} />
                              {group.name}
                            </label>
                          ))}
                        </div>
                        <p className="mt-2 text-sm">
                          <Link className="font-semibold text-pine" href="/admin/access">Manage groups on Access</Link>
                        </p>
                      </div>
                      <div>
                        <p className="label">People to notify</p>
                        <div className="mt-2 max-h-48 space-y-1 overflow-auto text-sm">
                          {users.map((account) => (
                            <label key={account.id} className="flex items-center gap-2">
                              <input name="recipientUser" type="checkbox" value={account.id} defaultChecked={process.recipients.some((row) => row.userId === account.id)} />
                              {account.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <button className="btn" type="submit">Save workflow</button>
                </form>
                {process.kind === "TASK" ? (
                  <div className="space-y-3">
                    {process.steps.map((step, index) => (
                      <div key={step.id} className="rounded-md border border-line p-3">
                        <form action={saveWorkflowStep} className="space-y-3">
                          <input type="hidden" name="id" value={step.id} />
                          <input type="hidden" name="processId" value={process.id} />
                          <div className="grid gap-2 md:grid-cols-4">
                            <label>
                              <span className="label">Step</span>
                              <input className="field" name="name" defaultValue={step.name} />
                            </label>
                            <label>
                              <span className="label">Group <HelpTip text="The group that receives this action. Members see it on the dashboard unless one person is named below." /></span>
                              <select className="field" name="groupId" defaultValue={step.groupId}>
                                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                              </select>
                            </label>
                            <label>
                              <span className="label">Assignee <HelpTip text="Optional. New actions for this step go to this person. They must belong to the group." /></span>
                              <select className="field" name="assigneeUserId" defaultValue={step.assigneeUserId ?? ""}>
                                <option value="">Anyone in the group</option>
                                {users.filter((account) => account.groups.some((membership) => membership.groupId === step.groupId)).map((account) => (
                                  <option key={account.id} value={account.id}>{account.name}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span className="label">Deadline days</span>
                              <input className="field" name="deadlineDays" type="number" min={1} defaultValue={step.deadlineDays} />
                            </label>
                          </div>
                          <p className="text-sm">
                            <Link className="font-semibold text-pine" href="/admin/access">Manage groups on Access</Link>
                          </p>
                          <div className="space-y-2">
                            {categories.map((category) => {
                              const selected = category.fields.some((field) => step.fields.some((item) => item.fieldId === field.id));
                              return (
                                <details key={category.id} {...(selected ? { open: true } : {})}>
                                  <summary className="section-toggle flex cursor-pointer items-center gap-2 text-sm font-semibold">
                                    <span className="mark" aria-hidden="true" />
                                    {category.name}
                                  </summary>
                                  <div className="mt-1 space-y-1 pl-7">
                                    {category.fields.map((field) => {
                                      const requirement = step.fields.find((item) => item.fieldId === field.id);
                                      return (
                                        <label key={field.id} className="flex flex-wrap items-center gap-2 text-sm">
                                          <span className="w-48">{field.friendlyName}</span>
                                          <select className="field w-auto" name={`rule:${field.id}`} defaultValue={requirement?.rule ?? ""}>
                                            <option value="">Not required</option>
                                            <option value="MUST_HAVE_VALUE">Must have a value</option>
                                            <option value="MUST_CHANGE">Must be changed on this step</option>
                                          </select>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </details>
                              );
                            })}
                          </div>
                          <button className="btn-quiet" type="submit">Save step</button>
                        </form>
                        <div className="mt-2 flex items-center gap-2">
                          {index > 0 ? (
                            <form action={moveWorkflowStep}>
                              <input type="hidden" name="id" value={step.id} />
                              <input type="hidden" name="direction" value="up" />
                              <button className="btn-quiet" type="submit">Up</button>
                            </form>
                          ) : null}
                          {index < process.steps.length - 1 ? (
                            <form action={moveWorkflowStep}>
                              <input type="hidden" name="id" value={step.id} />
                              <input type="hidden" name="direction" value="down" />
                              <button className="btn-quiet" type="submit">Down</button>
                            </form>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    <form action={saveWorkflowStep} className="grid items-end gap-2 md:grid-cols-[1fr_1fr_1fr_8rem_auto]">
                      <input type="hidden" name="processId" value={process.id} />
                      <label>
                        <span className="label">New step</span>
                        <input className="field" name="name" placeholder="Step name" required />
                      </label>
                      <label>
                        <span className="label">Group</span>
                        <select className="field" name="groupId" required>
                          <option value="">Group</option>
                          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                        </select>
                      </label>
                      <label>
                        <span className="label">Assignee</span>
                        <select className="field" name="assigneeUserId" defaultValue="">
                          <option value="">Anyone in the group</option>
                          {users.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                      </label>
                      <label>
                        <span className="label">Deadline days</span>
                        <input className="field" name="deadlineDays" type="number" min={1} defaultValue={1} />
                      </label>
                      <button className="btn" type="submit">Add step</button>
                    </form>
                  </div>
                ) : null}
              </div>
            </details>
          </section>
        ))}
      </fieldset>
    </div>
  );
}
