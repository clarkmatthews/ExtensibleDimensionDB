export const NAV_MODULES = [
  { id: "INBOX", label: "Dashboard", href: "/dashboard", group: "" },
  { id: "STORES", label: "Dimensions", href: "/dimensions", group: "" },
  { id: "TASK_REPORT", label: "Action report", href: "/reports/tasks", group: "" },
  { id: "DEFINITION", label: "Data definition", href: "/admin/definition", group: "Form Config" },
  { id: "LISTS", label: "Lists", href: "/admin/lists", group: "Form Config" },
  { id: "PERMISSIONS", label: "Permissions", href: "/admin/permissions", group: "People Config" },
  { id: "USERS", label: "Users", href: "/admin/users", group: "People Config" },
  { id: "ACCESS", label: "Access", href: "/admin/access", group: "People Config" },
  { id: "WORKFLOWS", label: "Workflows", href: "/admin/workflows", group: "People Config" },
  { id: "NOTICES", label: "Changelog", href: "/changelog", group: "" },
  { id: "SITE_CONFIG", label: "Site", href: "/admin/site", group: "Settings" },
  { id: "API_CONFIG", label: "API Config", href: "/admin/api", group: "Settings" },
  { id: "EMAIL_CONFIG", label: "Email Config", href: "/admin/email", group: "Settings" },
  { id: "AUDIT", label: "Audit log", href: "/admin/audit", group: "Settings" },
] as const;

export type NavModuleId = (typeof NAV_MODULES)[number]["id"];

export function moduleHref(moduleId: NavModuleId) {
  return NAV_MODULES.find((item) => item.id === moduleId)?.href ?? "/dashboard";
}
