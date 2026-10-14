import { NextRequest, NextResponse } from "next/server";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { filterRows, readColumnFilters, withActiveDefault } from "@/lib/column-filters";
import { loadStoreRows, loadVisibleFields } from "@/lib/store-query";
import { checkboxCheckedText } from "@/lib/values";
import { resolveVisibleRecordType } from "@/lib/record-access";
import { renderTable, TABLE_FORMATS, type TableFormat } from "@/lib/table-export";

function fileName(typeName: string) {
  return typeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "records";
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const access = await loadAccess(user);
  if (!canViewModule(access, "STORES")) return new NextResponse("Forbidden", { status: 403 });
  const { current } = await resolveVisibleRecordType(access, request.nextUrl.searchParams.get("type"));
  if (!current) return new NextResponse("No record type", { status: 404 });
  const requested = request.nextUrl.searchParams.get("format") ?? "csv";
  if (!(requested in TABLE_FORMATS)) return new NextResponse("Unknown format", { status: 400 });
  const format = requested as TableFormat;
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
  // Display names as headers; a name used in two dimensions becomes "Dimension: Name", which import also reads.
  const counts = new Map<string, number>();
  for (const field of fields) counts.set(field.friendlyName.toLowerCase(), (counts.get(field.friendlyName.toLowerCase()) ?? 0) + 1);
  const header = fields.map((field) => ((counts.get(field.friendlyName.toLowerCase()) ?? 0) > 1 ? `${field.category.name}: ${field.friendlyName}` : field.friendlyName));
  const table = [header, ...rows.map((row) => fields.map((field) => row.values[field.id] ?? ""))];
  const body = renderTable(table, format, current.name, { guardFormulas: true });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": TABLE_FORMATS[format].type,
      "Content-Disposition": `attachment; filename=${fileName(current.name)}.${format}`,
      "Cache-Control": "private, no-store",
    },
  });
}
