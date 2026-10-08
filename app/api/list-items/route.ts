import { NextRequest, NextResponse } from "next/server";
import { choicesForList } from "@/lib/list-items";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });
  const access = await loadAccess(user);
  if (!canViewModule(access, "STORES") && !canViewModule(access, "DEFINITION")) {
    return NextResponse.json({ items: [] }, { status: 403 });
  }
  const listId = request.nextUrl.searchParams.get("listId") ?? "";
  const parent = request.nextUrl.searchParams.get("parent") ?? "";
  if (!listId) return NextResponse.json({ items: [] });
  const list = await prisma.choiceList.findUnique({ where: { id: listId }, select: { id: true, parentListId: true, isActive: true } });
  if (!list?.isActive) return NextResponse.json({ items: [] });
  const items = await choicesForList(list.id, list.parentListId ? parent : null);
  return NextResponse.json({ items });
}
