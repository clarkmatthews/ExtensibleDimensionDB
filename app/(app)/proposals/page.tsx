import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpTip } from "@/components/help-tip";
import { BulkReview } from "@/components/bulk-review";
import { ModuleDenied } from "@/components/module-denied";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { reviewProposal } from "@/lib/proposal-actions";
import { currentValues, reviewBlocker, type ProposedChange } from "@/lib/proposals";
import { recordLabels } from "@/lib/record-types";
import { visibleProposals } from "@/lib/row-scope";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "AI proposals" };

const SAVED: Record<string, string> = { approved: "Proposal approved and saved.", rejected: "Proposal rejected." };

/** The summary after Approve all or Reject all. */
function bulkSummary(params: { saved?: string; done?: string; failed?: string; skipped?: string }) {
  if (params.saved !== "approvedAll" && params.saved !== "rejectedAll") return null;
  const count = (raw?: string) => Math.max(0, Number.parseInt(raw ?? "0", 10) || 0);
  const done = count(params.done);
  const failed = count(params.failed);
  const skipped = count(params.skipped);
  const approve = params.saved === "approvedAll";
  const parts = [`${approve ? "Approved and saved" : "Rejected"} ${done} ${done === 1 ? "proposal" : "proposals"}.`];
  if (failed) parts.push(`${failed} could not be ${approve ? "applied" : "rejected"}; see Recently reviewed for the reason.`);
  if (skipped) parts.push(`${skipped} had already been reviewed by someone else.`);
  return { text: parts.join(" "), problem: failed > 0 };
}

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; done?: string; failed?: string; skipped?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "PROPOSALS")) return <ModuleDenied />;
  const canReview = canEditModule(access, "PROPOSALS");
  const params = await searchParams;
  const [pending, reviewed, types] = await Promise.all([
    prisma.changeProposal.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { proposedBy: { select: { name: true } }, token: { select: { name: true } } },
      take: 100,
    }),
    prisma.changeProposal.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { reviewedAt: "desc" },
      include: { proposedBy: { select: { name: true } }, reviewer: { select: { name: true } } },
      take: 30,
    }),
    prisma.recordType.findMany({ select: { id: true, name: true } }),
  ]);
  const [shownPending, shownReviewed] = await Promise.all([visibleProposals(access, pending), visibleProposals(access, reviewed)]);
  const labels = await recordLabels([...shownPending, ...shownReviewed].flatMap((row) => [row.locationId ?? "", row.appliedLocationId ?? ""]));
  const typeName = (id: string) => types.find((type) => type.id === id)?.name ?? "record";
  const nowValues = new Map(await Promise.all(shownPending.map(async (row) => [row.id, await currentValues(row, access)] as const)));
  // Approve all and Reject all cover the proposals listed here that this person may review.
  const reviewable = canReview ? shownPending.filter((row) => !reviewBlocker(access, row)).map((row) => row.id) : [];
  const bulk = bulkSummary(params);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          AI proposals
          <HelpTip text="Changes that AI assistants proposed through AI access. Nothing is saved until someone approves it. Approving saves the change as the person whose token was used, with the reviewer recorded here and in the Audit log, and runs workflows and webhooks like any other edit." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Check each change and the reason the assistant gave. You can only approve attributes you are allowed to update, and someone else must review proposals made with your own token.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {SAVED[params.saved ?? ""] ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">{SAVED[params.saved ?? ""]}</p> : null}
      {bulk ? <p className={`rounded-md px-3 py-2 text-sm ${bulk.problem ? "bg-amber-50 text-warn" : "bg-emerald-50 text-pine"}`} role="status">{bulk.text}</p> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Waiting for review{shownPending.length ? ` (${shownPending.length})` : ""}</h2>
        {shownPending.length === 0 ? <p className="text-sm text-muted">Nothing is waiting.</p> : null}
        {reviewable.length > 1 ? <BulkReview ids={reviewable} waiting={shownPending.length} /> : null}
        {shownPending.map((proposal) => {
          const changes = proposal.changes as unknown as ProposedChange[];
          const current = nowValues.get(proposal.id) ?? new Map<string, string>();
          const blocked = canReview ? reviewBlocker(access, proposal) : "You can view proposals. Edit access is required to review them.";
          return (
            <article key={proposal.id} className="panel space-y-3 p-4 text-sm">
              <p>
                {proposal.locationId ? (
                  <Link className="font-semibold text-pine" href={`/dimensions/${proposal.locationId}`}>{labels.get(proposal.locationId)}</Link>
                ) : (
                  <span className="font-semibold">New {typeName(proposal.recordTypeId)}</span>
                )}
                <span className="text-muted"> · proposed by {proposal.proposedBy.name}{proposal.token ? ` with ${proposal.token.name}` : ""} · {proposal.createdAt.toLocaleString()}</span>
              </p>
              {proposal.reason ? <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2">{proposal.reason}</p> : null}
              <table className="min-w-full">
                <thead className="text-left">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">Attribute</th>
                    <th className="py-1 pr-3 font-semibold">Now</th>
                    <th className="py-1 font-semibold">Proposed</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change) => {
                    const now = proposal.locationId ? (current.get(change.fieldId) ?? "") : "";
                    const moved = proposal.locationId && now !== change.from;
                    return (
                      <tr key={change.fieldId} className="border-t border-line align-top">
                        <td className="py-1 pr-3">{change.name}</td>
                        <td className="py-1 pr-3 text-muted">
                          {now || "blank"}
                          {moved ? <span className="block text-xs text-warn">Changed since the proposal (was {change.from || "blank"})</span> : null}
                        </td>
                        <td className="py-1">{change.to || "blank"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {blocked ? <p className="text-xs text-muted">{blocked}</p> : (
                <form action={reviewProposal} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={proposal.id} />
                  <label className="flex-1">
                    <span className="label">Note (optional)</span>
                    <input className="field" name="note" />
                  </label>
                  <button className="btn" type="submit" name="decision" value="approve">Approve and save</button>
                  <button className="btn-quiet" type="submit" name="decision" value="reject">Reject</button>
                </form>
              )}
            </article>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Recently reviewed</h2>
        {shownReviewed.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="panel divide-y text-sm">
            {shownReviewed.map((proposal) => {
              const target = proposal.appliedLocationId ?? proposal.locationId;
              return (
                <li key={proposal.id} className="px-4 py-2">
                  <span className="font-semibold">{proposal.status.charAt(0) + proposal.status.slice(1).toLowerCase()}</span>
                  {" · "}
                  {target ? <Link className="text-pine" href={`/dimensions/${target}`}>{labels.get(target)}</Link> : `New ${typeName(proposal.recordTypeId)}`}
                  <span className="text-muted">
                    {" "}· by {proposal.proposedBy.name}{proposal.reviewer ? `, reviewed by ${proposal.reviewer.name}` : ""}
                    {proposal.reviewedAt ? ` · ${proposal.reviewedAt.toLocaleString()}` : ""}
                    {proposal.reviewNote ? ` · ${proposal.reviewNote}` : ""}
                    {proposal.error ? ` · ${proposal.error}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
