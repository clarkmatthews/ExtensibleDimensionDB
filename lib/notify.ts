import { deliverMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { siteName } from "@/lib/site";

export async function notifyUsers(userIds: string[], message: string, taskId?: string, fieldChangeId?: string, locationId?: string) {
  const unique = [...new Set(userIds)].filter(Boolean);
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
