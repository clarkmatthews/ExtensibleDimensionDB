import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
export type DeletePreview = { error: string; title: string; message: string };

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Removes actions and the notices and history that point at them. */
async function deleteTasks(db: Db, taskIds: string[]) {
  if (!taskIds.length) return;
  await db.notification.updateMany({ where: { taskId: { in: taskIds } }, data: { taskId: null } });
  // Events and watchers go with their action (cascade).
  await db.task.deleteMany({ where: { id: { in: taskIds } } });
}

/** Actions still waiting on this step: not completed, in a run that is open or suspended. */
async function openStepTasks(db: Db, stepId: string) {
  return db.task.count({ where: { stepId, completedAt: null } });
}

export async function previewWorkflowStepDelete(db: Db, id: string): Promise<DeletePreview> {
  const step = await db.workflowStep.findUnique({ where: { id }, include: { process: { select: { name: true } } } });
  if (!step) return { error: "This step was not found.", title: "", message: "" };
  const open = await openStepTasks(db, id);
  if (open) {
    return {
      error: `${plural(open, "record")} ${open === 1 ? "is" : "are"} waiting on this step. Finish, skip or reject ${open === 1 ? "that action" : "those actions"} on the dashboard first, then delete the step.`,
      title: `Delete ${step.name}?`,
      message: "",
    };
  }
  const done = await db.task.count({ where: { stepId: id } });
  const sentences = [`${step.name} is removed from ${step.process.name}. Records already past this step are not affected.`];
  if (done) sentences.push(`Its history of ${plural(done, "completed action")} is removed too.`);
  return { error: "", title: `Delete ${step.name}?`, message: sentences.join(" ") };
}

export async function deleteWorkflowStepGraph(db: Db, id: string): Promise<string> {
  const step = await db.workflowStep.findUnique({ where: { id } });
  if (!step) return "This step was not found.";
  if (await openStepTasks(db, id)) return "Records are waiting on this step. Finish those actions first.";
  const tasks = await db.task.findMany({ where: { stepId: id }, select: { id: true } });
  await deleteTasks(db, tasks.map((task) => task.id));
  await db.workflowStep.delete({ where: { id } });
  // Close the gap so Up and Down keep working.
  const rest = await db.workflowStep.findMany({ where: { processId: step.processId }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  for (const [index, item] of rest.entries()) {
    await db.workflowStep.update({ where: { id: item.id }, data: { sortOrder: index + 1 } });
  }
  return "";
}

export async function previewWorkflowDelete(db: Db, id: string): Promise<DeletePreview> {
  const process = await db.workflowProcess.findUnique({ where: { id }, include: { _count: { select: { steps: true } } } });
  if (!process) return { error: "This workflow was not found.", title: "", message: "" };
  const [runs, open] = await Promise.all([
    db.storeProcess.count({ where: { processId: id } }),
    db.storeProcess.count({ where: { processId: id, status: { in: ["ACTIVE", "SUSPENDED"] } } }),
  ]);
  const sentences = [`${process.name} and its ${plural(process._count.steps, "step")} are removed. It stops running on new records and changes.`];
  if (open) sentences.push(`${plural(open, "record")} still ${open === 1 ? "has it" : "have it"} open; ${open === 1 ? "that action is" : "those actions are"} removed from the dashboard.`);
  if (runs) sentences.push(`The history of ${plural(runs, "run")} is removed. To keep the history, clear Active instead.`);
  return { error: "", title: `Delete ${process.name}?`, message: sentences.join(" ") };
}

export async function deleteWorkflowGraph(db: Db, id: string): Promise<string> {
  const process = await db.workflowProcess.findUnique({ where: { id }, select: { id: true } });
  if (!process) return "This workflow was not found.";
  const runs = await db.storeProcess.findMany({ where: { processId: id }, select: { id: true } });
  const runIds = runs.map((run) => run.id);
  if (runIds.length) {
    const tasks = await db.task.findMany({ where: { storeProcessId: { in: runIds } }, select: { id: true } });
    await deleteTasks(db, tasks.map((task) => task.id));
    await db.storeProcess.deleteMany({ where: { id: { in: runIds } } });
  }
  // Steps, their required attributes, dimensions, triggers and recipients go with the workflow (cascade).
  await db.workflowProcess.delete({ where: { id } });
  return "";
}
