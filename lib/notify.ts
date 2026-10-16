import { deliverMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { usersWhoCanSee } from "@/lib/row-scope";
import { siteName } from "@/lib/site";

/** The record a notice is about: given directly, or through its action or change. */
async function noticeRecord(taskId?: string, fieldChangeId?: string, locationId?: string) {
  if (locationId) return locationId;
  if (taskId) {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { locationId: true } });
    if (task) return task.locationId;
  }
  if (fieldChangeId) {
    const change = await prisma.fieldChange.findUnique({ where: { id: fieldChangeId }, select: { locationId: true } });
    if (change) return change.locationId;
  }
  return null;
}

/**
 * Saves a notice for each person and emails them. A notice about a record only goes to people
 * whose scopes let them see it, so neither the message nor the email reaches anyone else.
 */
export async function notifyUsers(userIds: string[], message: string, taskId?: string, fieldChangeId?: string, locationId?: string) {
  let unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return;
  const recordId = await noticeRecord(taskId, fieldChangeId, locationId);
  if (recordId) unique = await usersWhoCanSee(unique, recordId);
  if (!unique.length) return;
  await prisma.notification.createMany({
    data: unique.map((userId) => ({ userId, message, taskId, fieldChangeId, locationId })),
  });
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, isActive: true },
    select: { email: true },
  });
  const recipients = users.map((user) => user.email);
  if (!recipients.length) return;
  const name = await siteName();
  const base = process.env.APP_URL?.trim();
  const link = locationId && base ? `\n\nOpen the record: ${new URL(`/dimensions/${locationId}`, base).toString()}` : "";
  await deliverMail({
    to: recipients,
    subject: fieldChangeId ? `${name} change` : taskId ? `${name} action` : `${name} notice`,
    text: message + link,
  });
}

export async function groupMemberIds(groupId: string) {
  const members = await prisma.userGroup.findMany({
    where: { groupId, user: { isActive: true } },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

export async function watcherIds(taskId: string) {
  const watchers = await prisma.taskWatcher.findMany({
    where: { taskId },
    select: { userId: true },
  });
  return watchers.map((watcher) => watcher.userId);
}
