import { NextRequest, NextResponse } from "next/server";
import { parseFileTokens, servingHeaders } from "@/lib/files";
import { canSeeValue, canViewModule, loadAccess } from "@/lib/permissions";
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
  const file = await prisma.storedFile.findUnique({
    where: { id },
    select: { id: true, name: true, size: true, data: true, fieldId: true, locationId: true, field: { select: { categoryId: true } } },
  });
  // Files not attached to a record, or that the person may not view, are reported as missing.
  if (!file?.locationId || !canSeeValue(access, file.fieldId, file.field.categoryId)) return notFound();
  const value = await prisma.fieldValue.findUnique({
    where: { locationId_fieldId: { locationId: file.locationId, fieldId: file.fieldId } },
    select: { valueText: true },
  });
  if (!parseFileTokens(value?.valueText).some((item) => item.id === file.id)) return notFound();
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      ...servingHeaders(file.name, request.nextUrl.searchParams.get("download") === "1"),
      "Content-Length": String(file.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
