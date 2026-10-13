import { redirect } from "next/navigation";

/** Permissions now live on each group, with per-person overrides on the person's page. */
export default async function PermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ subjectType?: string; subjectId?: string }>;
}) {
  const { subjectType, subjectId } = await searchParams;
  if (subjectType === "USER" && subjectId) redirect(`/admin/users/${encodeURIComponent(subjectId)}#own-settings`);
  if (subjectType === "GROUP" && subjectId) redirect(`/admin/access?open=${encodeURIComponent(subjectId)}#group-${encodeURIComponent(subjectId)}`);
  redirect("/admin/access");
}
