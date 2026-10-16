import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { canSeeValue, canViewModule, loadAccess } from "@/lib/permissions";
import { filterVisibleIds, locationConstraint } from "@/lib/row-scope";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Changelog" };

export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; record?: string; category?: string; field?: string; user?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "NOTICES")) return <ModuleDenied />;
  const params = await searchParams;
  const [categories, fields, people] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.fieldDefinition.findMany({ where: { isActive: true }, orderBy: { friendlyName: "asc" }, include: { category: true } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const from = params.from ? new Date(`${params.from}T00:00:00`) : null;
  const to = params.to ? new Date(`${params.to}T23:59:59`) : null;
  const record = params.record?.trim() ?? "";
  let locationIds: string[] | undefined;
  if (record) {
    const keys = await prisma.fieldValue.findMany({
      where: { field: { isStoreKey: true }, valueText: { contains: record, mode: "insensitive" } },
      select: { locationId: true },
    });
    const matched = await filterVisibleIds(access, keys.map((row) => row.locationId));
    locationIds = [...matched];
  }
  const scope = await locationConstraint(access);
  const query = params.q?.trim() ?? "";
  const rows = locationIds && locationIds.length === 0
    ? []
    : await prisma.fieldChange.findMany({
        where: {
          ...(scope ? { location: scope } : {}),
          ...(locationIds ? { locationId: { in: locationIds } } : {}),
          ...(params.field ? { fieldId: params.field } : {}),
          ...(params.user ? { userId: params.user } : {}),
          ...(params.category ? { field: { categoryId: params.category } } : {}),
          ...(from || to ? { createdAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
          ...(query
            ? {
                OR: [
                  { oldValue: { contains: query, mode: "insensitive" } },
                  { newValue: { contains: query, mode: "insensitive" } },
                  { field: { friendlyName: { contains: query, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        include: { field: { include: { category: true } }, user: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
  const visible = rows.filter((row) => canSeeValue(access, row.fieldId, row.field.categoryId));
  const locationIdsOnPage = [...new Set(visible.map((row) => row.locationId))];
  const labels = new Map(
    (locationIdsOnPage.length
      ? await prisma.fieldValue.findMany({
          where: { locationId: { in: locationIdsOnPage }, field: { isStoreKey: true } },
        })
      : []
    ).map((row) => [row.locationId, row.valueText || row.locationId]),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Changelog
          <HelpTip text="Every saved attribute change is listed here with the previous value, the new value, who saved it, and when. Filters apply together. Search looks through the old value, the new value, and the attribute name." />
        </h1>
        <p className="text-sm text-muted">Attribute edits on records, with the previous value and the new value.</p>
      </div>
      <form className="panel grid gap-3 p-4 md:grid-cols-3" action="/changelog">
        <label>
          <span className="label">Search</span>
          <input className="field" name="q" defaultValue={params.q ?? ""} placeholder="Old value, new value, or attribute" />
        </label>
        <label>
          <span className="label">Record</span>
          <input className="field" name="record" defaultValue={record} placeholder="Unique identifier" />
        </label>
        <label>
          <span className="label">Dimension</span>
          <select className="field" name="category" defaultValue={params.category ?? ""}>
            <option value="">Any dimension</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Attribute</span>
          <select className="field" name="field" defaultValue={params.field ?? ""}>
            <option value="">Any attribute</option>
            {fields.map((field) => <option key={field.id} value={field.id}>{field.category.name}: {field.friendlyName}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Person</span>
          <select className="field" name="user" defaultValue={params.user ?? ""}>
            <option value="">Anyone</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">From</span>
            <input className="field" type="date" name="from" defaultValue={params.from ?? ""} />
          </label>
          <label>
            <span className="label">To</span>
            <input className="field" type="date" name="to" defaultValue={params.to ?? ""} />
          </label>
        </div>
        <button className="btn w-fit" type="submit">Filter</button>
      </form>
      {visible.length === 0 ? <p className="text-sm text-muted">No changes match.</p> : null}
      <div className="space-y-2">
        {visible.map((row) => (
          <article key={row.id} className="panel px-4 py-3 text-sm">
            <p>
              <Link className="font-semibold text-pine" href={`/dimensions/${row.locationId}`}>{labels.get(row.locationId) || "Record"}</Link>
              {" · "}{row.field.category.name} · {row.field.friendlyName}
            </p>
            <p className="mt-1">
              <span className="text-muted">{row.oldValue || "blank"}</span>
              {" → "}
              <span>{row.newValue || "blank"}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {row.user.name} · {row.createdAt.toLocaleString()}
              {row.proposalId ? " · from an approved AI proposal" : ""}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
