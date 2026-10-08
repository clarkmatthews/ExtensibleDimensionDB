import { redirect } from "next/navigation";
import { ListsAdmin, type ManagedList } from "@/components/lists-admin";
import { ModuleDenied } from "@/components/module-denied";
import { ensurePlaceCatalog } from "@/lib/place-catalog";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export default async function ListsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; open?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "LISTS")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "LISTS");
  const params = await searchParams;
  await ensurePlaceCatalog();
  const [rows, counts] = await Promise.all([
    prisma.choiceList.findMany({
      orderBy: { name: "asc" },
      include: {
        items: {
          where: { list: { parentListId: null } },
          orderBy: { sortOrder: "asc" },
        },
        fields: { select: { friendlyName: true }, orderBy: { friendlyName: "asc" } },
      },
    }),
    prisma.choiceListItem.groupBy({
      by: ["listId"],
      where: { isActive: true },
      _count: { _all: true },
    }),
  ]);
  const countByList = new Map(counts.map((row) => [row.listId, row._count._all]));
  const lists: ManagedList[] = rows.map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    isActive: list.isActive,
    choiceSource: list.choiceSource,
    parentListId: list.parentListId ?? "",
    fields: list.fields.map((field) => field.friendlyName),
    activeCount: countByList.get(list.id) ?? 0,
    items: list.items.map((item) => ({
      id: item.id,
      label: item.label,
      value: item.value,
      isDefault: item.isDefault,
      parentValues: item.parentValues,
      isActive: item.isActive,
    })),
  }));

  return (
    <ListsAdmin
      lists={lists}
      initialOpen={params.open ?? ""}
      error={params.error ?? ""}
      canEdit={canEdit}
    />
  );
}
