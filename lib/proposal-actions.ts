"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audited } from "@/lib/audit";
import { loadAccess } from "@/lib/permissions";
import { approveProposal, rejectProposal } from "@/lib/proposals";
import { getCurrentUser } from "@/lib/session";

const PAGE = "/proposals";

export async function reviewProposal(formData: FormData) {
  const decision = String(formData.get("decision") ?? "");
  return audited(decision === "approve" ? "proposals.approve" : "proposals.reject", [formData], async () => {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    const access = await loadAccess(user);
    const id = String(formData.get("id") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    const error = decision === "approve" ? await approveProposal(id, access, note) : await rejectProposal(id, access, note);
    revalidatePath(PAGE);
    revalidatePath("/dimensions");
    revalidatePath("/changelog");
    redirect(error ? `${PAGE}?error=${encodeURIComponent(error)}` : `${PAGE}?saved=${decision === "approve" ? "approved" : "rejected"}`);
  });
}
