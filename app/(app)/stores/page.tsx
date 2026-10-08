import { redirect } from "next/navigation";
import { searchSuffix } from "@/lib/column-filters";

export default async function StoresRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(`/dimensions${searchSuffix(params)}`);
}
