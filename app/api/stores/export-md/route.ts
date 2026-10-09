import { NextResponse } from "next/server";
import { exportKnowledgeMarkdown } from "@/lib/knowledge";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const access = await loadAccess(user);
  if (!canViewModule(access, "STORES")) return new NextResponse("Forbidden", { status: 403 });
  const markdown = await exportKnowledgeMarkdown(access);
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": "attachment; filename=dimensions.md",
    },
  });
}
