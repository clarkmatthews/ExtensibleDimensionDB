import { redirect } from "next/navigation";
import { searchSuffix } from "@/lib/column-filters";

export default async function StoreRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  redirect(`/dimensions/${id}${searchSuffix(query)}`);
}
