import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { NAV_MODULES, type NavModuleId } from "@/lib/nav-modules";
import { managesOwnPassword, mustChooseOwnPassword } from "@/lib/password-policy";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { noticeConstraint } from "@/lib/row-scope";
import { getCurrentUser } from "@/lib/session";
import { siteName } from "@/lib/site";
import { loadSsoSettings } from "@/lib/sso";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sso = await loadSsoSettings().catch(() => null);
  if (mustChooseOwnPassword(user, sso)) redirect("/account/password");
  const [access, name] = await Promise.all([loadAccess(user), siteName()]);
  // Notices about records outside this person's scope are not counted, matching the dashboard.
  const hidden = await noticeConstraint(access);
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null, ...(hidden ? { AND: [hidden] } : {}) } });
  const allowedModules = NAV_MODULES.filter((item) => canViewModule(access, item.id)).map((item) => item.id) as NavModuleId[];
  return (
    <Shell name={user.name} email={user.email} canChangePassword={managesOwnPassword(user, sso)} siteName={name} unread={unread} allowedModules={allowedModules}>
      {children}
    </Shell>
  );
}
