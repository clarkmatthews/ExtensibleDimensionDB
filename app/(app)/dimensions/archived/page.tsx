import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { recordTypeRights } from "@/lib/record-access";
import { locationConstraint } from "@/lib/row-scope";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { restoreRecord } from "@/lib/store-actions";

export const metadata: Metadata = { title: "Archived records" };

export default async function ArchivedRecordsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "STORES")) return <ModuleDenied />;
  const typeRights = await recordTypeRights(access);
  const visibleTypes = [...typeRights].filter(([, rights]) => rights.canView).map(([id]) => id);
  const scope = await locationConstraint(access);
  const records = await prisma.location.findMany({
    // Only record types this person can see, and only rows their scopes allow.
    where: { isActive: false, recordTypeId: { in: visibleTypes }, ...(scope ?? {}) },
    orderBy: { archivedAt: "desc" },
    take: 500,
    include: {
      values: { where: { field: { isStoreKey: true } }, select: { valueText: true } },
      recordType: { select: { name: true } },
    },
  });
  const archiverIds = [...new Set(records.map((record) => record.archivedById).filter((id): id is string => Boolean(id)))];
  const archivers = new Map(
    (archiverIds.length ? await prisma.user.findMany({ where: { id: { in: archiverIds } }, select: { id: true, name: true } }) : [])
      .map((person) => [person.id, person.name]),
  );

  return (
    <div className="space-y-4">
      <div>
        <Link className="text-sm font-semibold text-pine" href="/dimensions">Dimension</Link>
        <h1 className="mt-1 flex items-center text-2xl font-semibold">
          Archived records
          <HelpTip text="Archived records are hidden from the grid, exports, the share API, and AI knowledge, and cannot be edited. Their values and changelog are kept. Restoring a record resumes the workflows that archiving paused." />
        </h1>
      </div>
      {records.length === 0 ? <p className="text-sm text-muted">No archived records.</p> : (
        <div className="panel divide-y">
          {records.map((record) => (
            <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <Link className="font-semibold text-pine" href={`/dimensions/${record.id}`}>
                  {record.values[0]?.valueText || record.id}
                </Link>
                <p className="text-xs text-muted">
                  {record.recordType.name} · Archived {record.archivedAt?.toLocaleString() ?? "earlier"}
                  {record.archivedById && archivers.get(record.archivedById) ? ` by ${archivers.get(record.archivedById)}` : ""}
                </p>
              </div>
              {typeRights.get(record.recordTypeId)?.canAdd ? (
                <form action={restoreRecord}>
                  <input type="hidden" name="locationId" value={record.id} />
                  <button className="btn-quiet" type="submit">Restore</button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
