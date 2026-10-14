import { NextRequest, NextResponse } from "next/server";
import { renderSample, SAMPLE_FORMATS, sampleTable, type SampleFormat } from "@/lib/import-samples";
import { canViewModule, loadAccess } from "@/lib/permissions";
import { rightsForType } from "@/lib/record-access";
import { listRecordTypes } from "@/lib/record-types";
import { getCurrentUser } from "@/lib/session";

/** A sample import file for one record type, in CSV, Excel, JSON, or XML, with this person's columns. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const access = await loadAccess(user);
  if (!canViewModule(access, "IMPORT")) return new NextResponse("Forbidden", { status: 403 });
  const typeId = request.nextUrl.searchParams.get("type") ?? "";
  const format = (request.nextUrl.searchParams.get("format") ?? "csv") as SampleFormat;
  if (!(format in SAMPLE_FORMATS)) return new NextResponse("Unknown format", { status: 400 });
  const type = (await listRecordTypes()).find((item) => item.id === typeId);
  if (!type || !(await rightsForType(access, type.id)).canView) return new NextResponse("Not found", { status: 404 });
  const body = renderSample(await sampleTable(access, type.id), format, type.name);
  const slug = type.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "records";
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": SAMPLE_FORMATS[format].type,
      "Content-Disposition": `attachment; filename="${slug}-import-sample.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
