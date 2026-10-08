import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { NAV_MODULES, type NavModuleId } from "@/lib/nav-modules";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { siteName } from "@/lib/site";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [unread, access, name] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    loadAccess(user),
    siteName(),
  ]);
  const allowedModules = NAV_MODULES.filter((item) => canViewModule(access, item.id)).map((item) => item.id) as NavModuleId[];
  return (
    <Shell name={user.name} siteName={name} unread={unread} allowedModules={allowedModules}>
      {children}
    </Shell>
  );
}
