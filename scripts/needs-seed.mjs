// Exits 0 when the database has no users yet (first start), 1 otherwise.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const users = await prisma.user.count();
  process.exit(users === 0 ? 0 : 1);
} finally {
  await prisma.$disconnect();
}
