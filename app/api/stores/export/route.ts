import { NextRequest, NextResponse } from "next/server";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { filterRows, readColumnFilters, withActiveDefault } from "@/lib/column-filters";
import { loadStoreRows, loadVisibleFields } from "@/lib/store-query";
import { checkboxCheckedText } from "@/lib/values";
import { resolveVisibleRecordType } from "@/lib/record-access";

function fileName(typeName: string) {
  return typeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "records";
}

function csvCell(value: string) {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const access = await loadAccess(user);
  if (!canViewModule(access, "STORES")) return new NextResponse("Forbidden", { status: 403 });
  const { current } = await resolveVisibleRecordType(access, request.nextUrl.searchParams.get("type"));
  if (!current) return new NextResponse("No record type", { status: 404 });
  const fields = await loadVisibleFields(access, current.id);
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const activeField = fields.find((field) => field.isActiveFilter && field.dataType === "CHECKBOX");
  const filters = withActiveDefault(
    readColumnFilters(Object.fromEntries(request.nextUrl.searchParams.entries())),
    activeField?.id,
    activeField ? request.nextUrl.searchParams.has(`v_${activeField.id}`) : true,
    activeField ? checkboxCheckedText(activeField) : "Yes",
  );
  const rows = filterRows(await loadStoreRows(fields, query, current.id), filters);
  const header = fields.map((field) => csvCell(field.friendlyName)).join(",");
  const body = rows
    .map((row) => fields.map((field) => csvCell(row.values[field.id] ?? "")).join(","))
    .join("\n");
  return new NextResponse(`${header}\n${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${fileName(current.name)}.csv`,
    },
  });
}
