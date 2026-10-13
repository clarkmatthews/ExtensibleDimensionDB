// Lists people whose access widened when departments were merged into groups.
// Run after upgrading:  docker compose exec app npm run report:department-merge
import { departmentMergeChanges } from "@/lib/department-merge-report";
import { prisma } from "@/lib/prisma";

async function main() {
  const merges = await prisma.departmentMerge.findMany({ orderBy: { departmentName: "asc" } });
  if (!merges.length) {
    console.log("No departments were merged, so nobody's access changed.");
    return;
  }
  const [users, categories, categoryPerms, fieldPerms, modulePerms] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, include: { groups: true }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ include: { fields: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } }),
    prisma.categoryPermission.findMany(),
    prisma.fieldPermission.findMany(),
    prisma.modulePermission.findMany(),
  ]);
  const groups = await prisma.group.findMany({ where: { id: { in: merges.map((merge) => merge.groupId) } }, select: { id: true, name: true } });
  console.log("Departments merged into groups:");
  for (const merge of merges) {
    const group = groups.find((item) => item.id === merge.groupId);
    console.log(`  ${merge.departmentName} → group "${group?.name ?? merge.groupId}"`);
  }
  const changes = departmentMergeChanges({
    people: users.map((user) => ({ id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin, groupIds: user.groups.map((row) => row.groupId) })),
    departmentGroupIds: merges.map((merge) => merge.groupId),
    categories,
    categoryPerms,
    fieldPerms,
    modulePerms,
  });
  console.log("");
  if (!changes.length) {
    console.log("Nobody's access changed. Everyone has exactly the access they had before.");
    return;
  }
  console.log(`${changes.length} access change${changes.length === 1 ? "" : "s"}, where a group used to hold back what a department granted:`);
  let person = "";
  for (const change of changes) {
    if (change.person !== person) {
      person = change.person;
      console.log(`\n  ${person}`);
    }
    console.log(`    ${change.item}: ${change.before} → ${change.after}`);
  }
  console.log("\nTo undo one, adjust the former department's group on Access or Permissions, or set the person's own grant on Permissions.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
