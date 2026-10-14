import { NextRequest, NextResponse } from "next/server";
import { visibleFile } from "@/lib/file-access";
import { servingHeaders } from "@/lib/files";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

const notFound = () => new NextResponse("Not found", { status: 404 });

/**
 * Sends a stored file to someone who may see the attribute's value on that record. PDFs and
 * images open in the browser; other types download. ?download=1 always downloads.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const access = await loadAccess(user);
  if (!canViewModule(access, "STORES")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  const visible = await visibleFile(access, id);
  if (!visible) return notFound();
  const file = await prisma.storedFile.findUnique({ where: { id }, select: { name: true, size: true, data: true } });
  if (!file) return notFound();
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      ...servingHeaders(file.name, request.nextUrl.searchParams.get("download") === "1"),
      "Content-Length": String(file.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
