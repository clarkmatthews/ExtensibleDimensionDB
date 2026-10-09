import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Audit log" };

const AREAS: { prefix: string; label: string }[] = [
  { prefix: "definition.", label: "Data definition" },
  { prefix: "lists.", label: "Lists" },
  { prefix: "access.", label: "People and permissions" },
  { prefix: "api.", label: "API Config" },
  { prefix: "mail.", label: "Email Config" },
  { prefix: "site.", label: "Site" },
  { prefix: "records.", label: "Records" },
  { prefix: "webhooks.", label: "Webhooks" },
  { prefix: "import.", label: "Import" },
  { prefix: "ai.", label: "AI access" },
  { prefix: "sso.", label: "Single sign-on" },
  { prefix: "proposals.", label: "AI proposals" },
  { prefix: "session.", label: "Sign-in sessions" },
];

/** Turns "access.saveUser" into "Save user". */
function actionLabel(action: string) {
  const name = action.split(".").slice(1).join(".") || action;
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b(sso|api|ai)\b/g, (word) => word.toUpperCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function detailLines(detail: unknown): string[] {
  if (!detail || typeof detail !== "object") return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
    if (key === "form" && value && typeof value === "object") {
      for (const [name, field] of Object.entries(value as Record<string, unknown>)) {
        const text = Array.isArray(field) ? field.join(", ") : String(field);
        if (text) lines.push(`${name}: ${text}`);
      }
    } else {
      lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
    }
  }
  return lines;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; user?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "AUDIT")) return <ModuleDenied />;
  const params = await searchParams;
  const from = params.from ? new Date(`${params.from}T00:00:00`) : null;
  const to = params.to ? new Date(`${params.to}T23:59:59`) : null;
  const area = AREAS.find((item) => item.prefix === params.area);
  const [people, rows] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.auditLog.findMany({
      where: {
        ...(area ? { action: { startsWith: area.prefix } } : {}),
        ...(params.user ? { userId: params.user } : {}),
        ...(from || to ? { createdAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Audit log
          <HelpTip text="Every successful change to data definitions, lists, people, permissions, workflows, API endpoints, email, and site settings, with who made it and when. Passwords and secrets are never recorded; a changed password shows as [changed]. Record values are in the Changelog." />
        </h1>
        <p className="text-sm text-muted">Administrative changes, newest first. The latest 200 that match are shown.</p>
      </div>
      <form className="panel grid gap-3 p-4 md:grid-cols-4" action="/admin/audit">
        <label>
          <span className="label">Area</span>
          <select className="field" name="area" defaultValue={params.area ?? ""}>
            <option value="">Any area</option>
            {AREAS.map((item) => <option key={item.prefix} value={item.prefix}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Person</span>
          <select className="field" name="user" defaultValue={params.user ?? ""}>
            <option value="">Anyone</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">From</span>
          <input className="field" type="date" name="from" defaultValue={params.from ?? ""} />
        </label>
        <label>
          <span className="label">To</span>
          <input className="field" type="date" name="to" defaultValue={params.to ?? ""} />
        </label>
        <button className="btn w-fit" type="submit">Filter</button>
      </form>
      {rows.length === 0 ? <p className="text-sm text-muted">No changes match.</p> : null}
      <div className="space-y-2">
        {rows.map((row) => {
          const lines = detailLines(row.detail);
          return (
            <article key={row.id} className="panel px-4 py-3 text-sm">
              <p className="font-semibold">
                {actionLabel(row.action)}
                <span className="font-normal text-muted"> · {AREAS.find((item) => row.action.startsWith(item.prefix))?.label ?? row.action}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {row.user ? `${row.user.name} (${row.user.email})` : "A removed user"} · {row.createdAt.toLocaleString()}
              </p>
              {lines.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted">Details</summary>
                  <ul className="mt-1 space-y-0.5 break-all font-mono text-xs">
                    {lines.map((line, index) => <li key={index}>{line}</li>)}
                  </ul>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
