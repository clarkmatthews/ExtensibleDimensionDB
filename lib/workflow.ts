import type { TaskPriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { groupMemberIds, notifyUsers, watcherIds } from "@/lib/notify";

const PRIORITY_UP: Record<TaskPriority, TaskPriority> = {
  LOW: "NORMAL",
  NORMAL: "HIGH",
  HIGH: "HIGH",
};
const PRIORITY_DOWN: Record<TaskPriority, TaskPriority> = {
  HIGH: "NORMAL",
  NORMAL: "LOW",
  LOW: "LOW",
};

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export type SavedChange = {
  id: string;
  fieldId: string;
  categoryId: string;
  attribute: string;
  oldValue: string;
  newValue: string;
};

function changeText(change: SavedChange, userName: string) {
  const before = change.oldValue || "blank";
  const after = change.newValue || "blank";
  return `${userName} changed ${change.attribute} from "${before}" to "${after}".`;
}

async function recipientIds(recipients: { groupId: string | null; userId: string | null }[]) {
  const ids: string[] = [];
  for (const recipient of recipients) {
    if (recipient.userId) ids.push(recipient.userId);
    if (recipient.groupId) ids.push(...(await groupMemberIds(recipient.groupId)));
  }
  return [...new Set(ids)];
}

async function notifyChange(
  recipients: { groupId: string | null; userId: string | null }[],
  change: SavedChange,
  userName: string,
) {
  await notifyUsers(await recipientIds(recipients), changeText(change, userName), undefined, change.id);
}

async function startTaskProcess(
  process: { id: string; name: string; steps: { id: string; groupId: string; deadlineDays: number; sortOrder: number }[] },
  locationId: string,
  userId: string,
  fieldChangeId?: string,
) {
  if (process.steps.length === 0) return "This workflow has no steps.";
  const active = await prisma.storeProcess.findFirst({
    where: { locationId, processId: process.id, status: "ACTIVE", suspended: false },
  });
  if (active) return "That workflow is already open for this record.";
  const step = [...process.steps].sort((left, right) => left.sortOrder - right.sortOrder)[0];
  const assigneeUserId = await activeStepAssignee(step.id, step.groupId);
  const run = await prisma.storeProcess.create({
    data: { locationId, processId: process.id, originatorId: userId, status: "ACTIVE" },
  });
  const task = await prisma.task.create({
    data: {
      storeProcessId: run.id,
      stepId: step.id,
      locationId,
      assigneeGroupId: step.groupId,
      assigneeUserId,
      senderUserId: userId,
      deadlineAt: addDays(new Date(), step.deadlineDays),
      fieldChangeId,
    },
  });
  await prisma.taskEvent.create({
    data: { taskId: task.id, userId, action: "COMMENT", comment: "Process started." },
  });
  await notifyUsers(
    assigneeUserId ? [assigneeUserId] : await groupMemberIds(step.groupId),
    assigneeUserId ? `A new ${process.name} action was assigned to you.` : `A new ${process.name} action was assigned to your group.`,
    task.id,
    fieldChangeId,
  );
  return null;
}

export async function runWorkflows(input: {
  locationId: string;
  userId: string;
  userName: string;
  created: boolean;
  changes: SavedChange[];
}) {
  const processes = await prisma.workflowProcess.findMany({
    where: { isActive: true },
    include: {
      categories: true,
      triggers: true,
      recipients: true,
      steps: { orderBy: { sortOrder: "asc" } },
    },
  });
  for (const process of processes) {
    const categoryIds = new Set(process.categories.map((row) => row.categoryId));
    const inScope = (categoryId: string) => categoryIds.size === 0 || categoryIds.has(categoryId);
    const matched = input.changes.filter((change) => {
      if (!inScope(change.categoryId)) return false;
      const trigger = process.triggers.find((item) => item.fieldId === change.fieldId);
      if (process.triggers.length > 0 && !trigger) return false;
      if (trigger?.matchValue.trim() && trigger.matchValue.trim() !== change.newValue) return false;
      return true;
    });
    if (input.created && process.onCreate) {
      if (process.kind === "NOTIFY") {
        const listed = process.triggers.length
          ? matched.filter((change) => process.triggers.some((item) => item.fieldId === change.fieldId))
          : [];
        if (listed.length) {
          for (const change of listed) await notifyChange(process.recipients, change, input.userName);
        } else {
          await notifyUsers(
            await recipientIds(process.recipients),
            `${input.userName} created a record.`,
          );
        }
      } else {
        await startTaskProcess(process, input.locationId, input.userId, matched[0]?.id);
      }
    }
    if (!input.created && process.onChange && matched.length && process.triggers.length > 0) {
      if (process.kind === "NOTIFY") {
        for (const change of matched) await notifyChange(process.recipients, change, input.userName);
      } else {
        await startTaskProcess(process, input.locationId, input.userId, matched[0]?.id);
      }
    }
  }
}

export async function startManualProcess(locationId: string, processId: string, userId: string) {
  const process = await prisma.workflowProcess.findFirst({
    where: { id: processId, isActive: true, manual: true, kind: "TASK" },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
  if (!process) return "That workflow cannot be started from the record.";
  return startTaskProcess(process, locationId, userId);
}

async function activeStepAssignee(stepId: string, groupId: string) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } });
  if (!step?.assigneeUserId) return null;
  const member = await prisma.userGroup.findFirst({
    where: { userId: step.assigneeUserId, groupId, user: { isActive: true } },
  });
  return member ? step.assigneeUserId : null;
}

async function openStep(input: {
  runId: string;
  locationId: string;
  stepId: string;
  groupId: string;
  senderUserId: string;
  deadlineAt: Date;
  actorId: string;
  comment: string;
}) {
  const assigneeUserId = await activeStepAssignee(input.stepId, input.groupId);
  const task = await prisma.task.create({
    data: {
      storeProcessId: input.runId,
      stepId: input.stepId,
      locationId: input.locationId,
      assigneeGroupId: input.groupId,
      assigneeUserId,
      senderUserId: input.senderUserId,
      deadlineAt: input.deadlineAt,
    },
  });
  await prisma.taskEvent.create({
    data: { taskId: task.id, userId: input.actorId, action: "COMMENT", comment: input.comment },
  });
  await notifyUsers(
    assigneeUserId ? [assigneeUserId] : await groupMemberIds(input.groupId),
    assigneeUserId ? "A dimension action was assigned to you." : "A dimension action was assigned to your group.",
    task.id,
  );
  return task;
}

export async function applyTaskAction(input: {
  taskId: string;
  userId: string;
  action: string;
  comment?: string;
  keepWatching?: boolean;
  assigneeUserId?: string;
  postponeDays?: number;
  nextDeadlineDays?: number;
}) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    include: {
      step: true,
      storeProcess: { include: { process: { include: { steps: { orderBy: { sortOrder: "asc" } } } } } },
    },
  });
  if (!task || task.completedAt || task.storeProcess.suspended) {
    return "That action is no longer open.";
  }
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { groups: true },
  });
  if (!user) return "You are not signed in.";
  const inGroup = user.groups.some((membership) => membership.groupId === task.assigneeGroupId);
  const assignedToMe = task.assigneeUserId === user.id || (!task.assigneeUserId && inGroup);
  if (!user.isAdmin && !assignedToMe && task.storeProcess.originatorId !== user.id) {
    return "This action is not on your dashboard.";
  }

  const comment = (input.comment ?? "").trim();
  const needsComment = ["REJECT", "SKIP", "POSTPONE"].includes(input.action);
  if (needsComment && !comment) return "A comment is required.";

  if (input.keepWatching) {
    await prisma.taskWatcher.upsert({
      where: { taskId_userId: { taskId: task.id, userId: user.id } },
      update: {},
      create: { taskId: task.id, userId: user.id },
    });
  }

  const steps = task.storeProcess.process.steps;
  const index = steps.findIndex((step) => step.id === task.stepId);

  if (input.action === "ACCEPT") {
    await prisma.task.update({
      where: { id: task.id },
      data: { state: "ACCEPTED", acceptedAt: new Date() },
    });
  } else if (input.action === "UPGRADE" || input.action === "DOWNGRADE") {
    await prisma.task.update({
      where: { id: task.id },
      data: { priority: input.action === "UPGRADE" ? PRIORITY_UP[task.priority] : PRIORITY_DOWN[task.priority] },
    });
  } else if (input.action === "ASSIGN") {
    if (!input.assigneeUserId) return "Choose a person in the group.";
    const member = await prisma.userGroup.findUnique({
      where: { userId_groupId: { userId: input.assigneeUserId, groupId: task.assigneeGroupId } },
    });
    if (!member) return "That person is not in the assigned group.";
    await prisma.task.update({
      where: { id: task.id },
      data: { assigneeUserId: input.assigneeUserId },
    });
    await notifyUsers([input.assigneeUserId], "A dimension action was assigned to you.", task.id);
  } else if (input.action === "WATCH" || input.action === "UNWATCH") {
    if (input.action === "WATCH") {
      await prisma.taskWatcher.upsert({
        where: { taskId_userId: { taskId: task.id, userId: user.id } },
        update: {},
        create: { taskId: task.id, userId: user.id },
      });
    } else {
      await prisma.taskWatcher.deleteMany({ where: { taskId: task.id, userId: user.id } });
    }
  } else if (input.action === "POSTPONE") {
    const days = Number(input.postponeDays);
    if (!Number.isFinite(days) || days === 0) return "Enter a number of days to move the deadline.";
    await prisma.task.update({
      where: { id: task.id },
      data: { deadlineAt: addDays(task.deadlineAt, days) },
    });
  } else if (input.action === "REJECT") {
    const previous = index > 0 ? steps[index - 1] : null;
    if (!previous) return "Cannot reject the action: there is no previous action for this process.";
    await prisma.task.update({
      where: { id: task.id },
      data: { state: "COMPLETE", completedAt: new Date() },
    });
    await openStep({
      runId: task.storeProcessId,
      locationId: task.locationId,
      stepId: previous.id,
      groupId: previous.groupId,
      senderUserId: user.id,
      deadlineAt: addDays(new Date(), previous.deadlineDays),
      actorId: user.id,
      comment: `Returned: ${comment}`,
    });
  } else if (input.action === "SKIP" || input.action === "DONE") {
    if (input.action === "DONE") {
      const required = await prisma.workflowStepField.findMany({
        where: { stepId: task.stepId },
        include: { field: true },
      });
      const values = await prisma.fieldValue.findMany({ where: { locationId: task.locationId } });
      const changes = await prisma.fieldChange.findMany({
        where: { locationId: task.locationId, createdAt: { gte: task.createdAt } },
        select: { fieldId: true },
      });
      const missing = required.filter((item) => {
        if (item.rule === "MUST_CHANGE") return !changes.some((change) => change.fieldId === item.fieldId);
        const value = values.find((row) => row.fieldId === item.fieldId);
        if (!value) return true;
        if (item.field.dataType === "CHECKBOX") return value.valueBoolean !== true && item.field.isRequired;
        return !value.valueText && value.valueNumber == null && value.valueDateTime == null && value.valueBoolean == null;
      });
      if (missing.length) {
        const needsChange = missing.some((item) => item.rule === "MUST_CHANGE");
        const needsValue = missing.some((item) => item.rule !== "MUST_CHANGE");
        if (needsChange && needsValue) return "Cannot mark the action done until the required attributes have values and the attributes that must change have been edited.";
        if (needsChange) return "Cannot mark the action done until the attributes that must change on this step have been edited.";
        return "Cannot mark the action done until its required attributes have values.";
      }
    }
    const next = steps[index + 1];
    if (!next && input.action === "SKIP") {
      return "Cannot skip the action: there is no next action for this process.";
    }
    await prisma.task.update({
      where: { id: task.id },
      data: { state: input.action === "SKIP" ? "SKIPPED" : "COMPLETE", completedAt: new Date() },
    });
    if (!next) {
      await prisma.storeProcess.update({
        where: { id: task.storeProcessId },
        data: { status: "COMPLETE" },
      });
    } else {
      const days = input.nextDeadlineDays && input.nextDeadlineDays > 0 ? input.nextDeadlineDays : next.deadlineDays;
      await openStep({
        runId: task.storeProcessId,
        locationId: task.locationId,
        stepId: next.id,
        groupId: next.groupId,
        senderUserId: user.id,
        deadlineAt: addDays(new Date(), days),
        actorId: user.id,
        comment: input.action === "SKIP" ? `Skipped: ${comment}` : "Step completed.",
      });
    }
  } else if (input.action === "SUSPEND") {
    if (task.storeProcess.originatorId !== user.id && !user.isAdmin) {
      return "Only the process originator may suspend this process.";
    }
    await prisma.storeProcess.update({
      where: { id: task.storeProcessId },
      data: { suspended: true, status: "SUSPENDED" },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { state: "SUSPENDED", completedAt: new Date() },
    });
  } else if (input.action === "COMMENT" || input.action === "PERFORM") {
    // History is written below.
  } else {
    return "Unknown action.";
  }

  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      userId: user.id,
      action: input.action as never,
      comment,
    },
  });

  if (!["ASSIGN", "WATCH", "UNWATCH"].includes(input.action)) {
    await notifyUsers(await watcherIds(task.id), `Action ${input.action.toLowerCase()}: ${comment || task.step.name}`, task.id);
  }
  return null;
}

export async function raiseOverdueAlerts() {
  const overdue = await prisma.task.findMany({
    where: {
      completedAt: null,
      state: { in: ["UNACCEPTED", "ACCEPTED"] },
      deadlineAt: { lt: new Date() },
      storeProcess: { suspended: false, status: "ACTIVE" },
      OR: [{ overdueNotifiedAt: null }, { overdueNotifiedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }],
    },
  });
  for (const task of overdue) {
    const recipients = [...(await watcherIds(task.id)), ...(await groupMemberIds(task.assigneeGroupId))];
    await notifyUsers(recipients, "A dimension action is overdue.", task.id);
    await prisma.task.update({ where: { id: task.id }, data: { overdueNotifiedAt: new Date() } });
  }
  return overdue.length;
}
