"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audited } from "@/lib/audit";
import { loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
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

/**
 * Approves or rejects every proposal listed, oldest first, after one confirmation for the whole set.
 * Each gets the same checks as a single review; one that cannot be applied is marked failed and the
 * rest still go ahead.
 */
export async function reviewAllProposals(formData: FormData) {
  const decision = String(formData.get("decision") ?? "") === "approve" ? "approve" : "reject";
  return audited(decision === "approve" ? "proposals.approveAll" : "proposals.rejectAll", [formData], async () => {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    const access = await loadAccess(user);
    const note = String(formData.get("note") ?? "").trim();
    const ids = [...new Set(formData.getAll("id").map(String).filter(Boolean))].slice(0, 100);
    const pending = await prisma.changeProposal.findMany({
      where: { id: { in: ids }, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    let done = 0;
    let failed = 0;
    for (const { id } of pending) {
      const error = decision === "approve" ? await approveProposal(id, access, note) : await rejectProposal(id, access, note);
      if (error) failed += 1;
      else done += 1;
    }
    revalidatePath(PAGE);
    revalidatePath("/dimensions");
    revalidatePath("/changelog");
    redirect(`${PAGE}?saved=${decision === "approve" ? "approvedAll" : "rejectedAll"}&done=${done}&failed=${failed}&skipped=${ids.length - pending.length}`);
  });
}
