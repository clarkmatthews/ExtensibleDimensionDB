import type { Prisma } from "@prisma/client";
import { normalizeCell } from "@/lib/import";
import { notifyUsers } from "@/lib/notify";
import { canEditModule, loadAccessForUsers, type AccessContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  canUpdateField,
  choicesFor,
  loadSaveContext,
  planSave,
  saveRecord,
  storedInputs,
  type LoadedField,
} from "@/lib/record-save";
import { recordLabels } from "@/lib/record-types";
import { displayRaw, displayStored } from "@/lib/values";
import { enqueueRecordEvent } from "@/lib/webhooks";
import { runWorkflows } from "@/lib/workflow";

/**
 * Governed AI write-back. An assistant can propose a change to a record (or a new record)
 * through the hosted MCP endpoint. The proposal is validated with the same rules as the
 * record form, then waits for a person to approve it. Only an approved proposal is saved,
 * and it is saved exactly like a form edit: changelog, workflows, and webhooks included.
 */

export type ProposedChange = { fieldId: string; key: string; name: string; from: string; to: string; input: string };

const MAX_CHANGES = 50;

function fold(value: string) {
  return value.trim().toLowerCase();
}

/** Finds an attribute of the record type by key or display name. */
function findField(fields: LoadedField[], name: string) {
  const wanted = fold(name);
  const byKey = fields.filter((field) => fold(field.key) === wanted);
  if (byKey.length === 1) return { field: byKey[0] };
  const byName = fields.filter((field) => fold(field.friendlyName) === wanted || fold(`${field.category.name}: ${field.friendlyName}`) === wanted);
  if (byName.length === 1) return { field: byName[0] };
  if (byName.length > 1) return { error: `${name} matches several attributes. Use the attribute key.` };
  return { error: `No attribute named ${name}.` };
}

async function reviewerIds(exceptUserId: string) {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  const access = await loadAccessForUsers(users.map((user) => user.id));
  return [...access.entries()]
    .filter(([id, ctx]) => id !== exceptUserId && canEditModule(ctx, "PROPOSALS"))
    .map(([id]) => id);
}

type ProposalInput = {
  access: AccessContext;
  tokenId: string | null;
  recordId?: string;
  recordType?: string;
  values: Record<string, string>;
  reason: string;
};

/** Validates and stores a proposal. Returns a message for the assistant either way. */
export async function createProposal(input: ProposalInput): Promise<{ ok: boolean; message: string; proposalId?: string }> {
  const { access } = input;
  if (!canEditModule(access, "STORES")) return { ok: false, message: "This account cannot change records." };
  const entries = Object.entries(input.values ?? {});
  if (!entries.length) return { ok: false, message: "Give at least one attribute and value in changes." };
  if (entries.length > MAX_CHANGES) return { ok: false, message: `Propose at most ${MAX_CHANGES} attribute changes at once.` };

  let locationId = "";
  let recordTypeId = "";
  if (input.recordId?.trim()) {
    const location = await prisma.location.findUnique({ where: { id: input.recordId.trim() }, select: { id: true, isActive: true, recordTypeId: true } });
    if (!location || !location.isActive) return { ok: false, message: "No active record with that id." };
    locationId = location.id;
    recordTypeId = location.recordTypeId;
  } else {
    const typeName = input.recordType?.trim();
    if (!typeName) return { ok: false, message: "Give record_id to change a record, or record_type to create one." };
    const type = await prisma.recordType.findFirst({ where: { name: { equals: typeName, mode: "insensitive" }, isActive: true } });
    if (!type) return { ok: false, message: `No record type named ${typeName}.` };
    recordTypeId = type.id;
  }

  const ctx = await loadSaveContext(recordTypeId);
  const stored = await storedInputs(locationId);
  const inputs = new Map<string, string>();
  const errors: string[] = [];
  for (const [name, value] of entries) {
    const found = findField(ctx.fields, name);
    if ("error" in found) {
      errors.push(found.error!);
      continue;
    }
    const field = found.field;
    if (!canUpdateField(access, field)) {
      errors.push(`${field.friendlyName}: this account cannot update it.`);
      continue;
    }
    if (field.dataType === "FILE") {
      errors.push(`${field.friendlyName}: files are uploaded by a person on the record, not proposed.`);
      continue;
    }
    const parent = field.parentFieldId ? ctx.fields.find((item) => item.id === field.parentFieldId) : undefined;
    const parentRaw = parent ? (inputs.get(parent.id) ?? stored.get(parent.id) ?? "") : "";
    inputs.set(field.id, normalizeCell(field, String(value ?? ""), await choicesFor(ctx, field, parentRaw)));
  }
  if (errors.length) return { ok: false, message: errors.join(" ") };

  const plan = await planSave(ctx, access, locationId, (field) => inputs.get(field.id), stored);
  if (!plan.ok) return { ok: false, message: `The change was not submitted: ${plan.errors.join(" ")}` };

  const changes = await describeChanges(locationId, plan.writes.filter((write) => inputs.has(write.field.id)));
  if (!changes.length) return { ok: false, message: "Nothing would change: the record already has these values." };

  const proposal = await prisma.changeProposal.create({
    data: {
      recordTypeId,
      locationId: locationId || null,
      proposedById: access.user.id,
      tokenId: input.tokenId,
      reason: input.reason.slice(0, 2000),
      changes: changes as unknown as Prisma.InputJsonValue,
    },
  });
  await notifyUsers(await reviewerIds(access.user.id), `An AI assistant proposed a change for ${access.user.name}. Review it on AI proposals.`);
  return {
    ok: true,
    proposalId: proposal.id,
    message: `Submitted proposal ${proposal.id} for review. Nothing is saved until a person approves it.\n${changes
      .map((change) => `- ${change.name}: ${change.from || "blank"} -> ${change.to || "blank"}`)
      .join("\n")}`,
  };
}

async function describeChanges(locationId: string, writes: { field: LoadedField; raw: string; options?: { label: string; value: string }[] }[]) {
  const current = locationId ? await prisma.fieldValue.findMany({ where: { locationId } }) : [];
  const changes: ProposedChange[] = [];
  for (const write of writes) {
    const from = displayStored(write.field, current.find((value) => value.fieldId === write.field.id), write.options);
    const to = displayRaw(write.field, write.raw, write.options);
    if (from === to && locationId) continue;
    changes.push({ fieldId: write.field.id, key: write.field.key, name: write.field.friendlyName, from, to, input: write.raw });
  }
  return changes;
}

/** Why this person may not review this proposal, or null when they may. */
export function reviewBlocker(reviewer: AccessContext, proposal: { proposedById: string; status: string }) {
  if (proposal.status !== "PENDING") return "This proposal has already been reviewed.";
  if (!canEditModule(reviewer, "PROPOSALS")) return "You cannot review AI proposals.";
  if (proposal.proposedById === reviewer.user.id && !reviewer.user.isAdmin) {
    return "Someone else must review a proposal made with your own token.";
  }
  return null;
}

/**
 * Applies an approved proposal. The reviewer must be able to update every attribute in it,
 * and the values are validated again against the record as it is now.
 */
export async function approveProposal(proposalId: string, reviewer: AccessContext, note: string) {
  const pending = await prisma.changeProposal.findUnique({ where: { id: proposalId } });
  if (!pending) return "This proposal no longer exists.";
  const blocked = reviewBlocker(reviewer, pending);
  if (blocked) return blocked;
  // Claim the proposal so two reviewers cannot both apply it.
  const claimed = await prisma.changeProposal.updateMany({
    where: { id: proposalId, status: "PENDING" },
    data: { status: "APPLYING", reviewerId: reviewer.user.id, reviewedAt: new Date(), reviewNote: note.slice(0, 2000) },
  });
  if (claimed.count === 0) return "This proposal has already been reviewed.";
  const proposal = await prisma.changeProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { proposedBy: true } });
  const fail = async (error: string) => {
    await prisma.changeProposal.update({ where: { id: proposalId }, data: { status: "FAILED", error } });
    return error;
  };
  const changes = proposal.changes as unknown as ProposedChange[];
  const ctx = await loadSaveContext(proposal.recordTypeId);
  for (const change of changes) {
    const field = ctx.fields.find((item) => item.id === change.fieldId);
    if (!field) return fail(`${change.name} no longer exists or is hidden.`);
    if (!canUpdateField(reviewer, field)) return fail(`You cannot update ${field.friendlyName}, so you cannot approve this change.`);
  }
  const inputs = new Map(changes.map((change) => [change.fieldId, change.input]));
  const saved = await saveRecord({
    ctx,
    access: reviewer,
    userId: proposal.proposedById,
    locationId: proposal.locationId ?? "",
    values: (field) => inputs.get(field.id),
    proposalId,
  });
  if (saved.error !== undefined) return fail(`The record could not be saved: ${saved.error}`);
  await prisma.changeProposal.update({ where: { id: proposalId }, data: { status: "APPLIED", appliedLocationId: saved.locationId } });
  if (saved.changes.length || saved.created) {
    await runWorkflows({
      locationId: saved.locationId,
      userId: proposal.proposedById,
      userName: proposal.proposedBy.name,
      created: saved.created,
      changes: saved.changes,
    });
    await enqueueRecordEvent({
      event: saved.created ? "record.created" : "record.updated",
      locationId: saved.locationId,
      actorName: proposal.proposedBy.name,
      changes: saved.changes,
    });
  }
  const label = (await recordLabels([saved.locationId])).get(saved.locationId) ?? saved.locationId;
  await notifyUsers([proposal.proposedById], `${reviewer.user.name} approved the AI proposal for ${label}.`);
  return null;
}

export async function rejectProposal(proposalId: string, reviewer: AccessContext, note: string) {
  const proposal = await prisma.changeProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return "This proposal no longer exists.";
  const blocked = reviewBlocker(reviewer, proposal);
  if (blocked) return blocked;
  const updated = await prisma.changeProposal.updateMany({
    where: { id: proposalId, status: "PENDING" },
    data: { status: "REJECTED", reviewerId: reviewer.user.id, reviewedAt: new Date(), reviewNote: note.slice(0, 2000) },
  });
  if (updated.count === 0) return "This proposal has already been reviewed.";
  await notifyUsers([proposal.proposedById], `${reviewer.user.name} rejected an AI proposal${note ? `: ${note.slice(0, 200)}` : "."}`);
  return null;
}

/** Current display values for the attributes in a proposal, to show what changed since. */
export async function currentValues(proposal: { locationId: string | null; recordTypeId: string; changes: unknown }) {
  if (!proposal.locationId) return new Map<string, string>();
  const ctx = await loadSaveContext(proposal.recordTypeId);
  const values = await prisma.fieldValue.findMany({ where: { locationId: proposal.locationId } });
  const stored = await storedInputs(proposal.locationId);
  const result = new Map<string, string>();
  for (const change of proposal.changes as ProposedChange[]) {
    const field = ctx.fields.find((item) => item.id === change.fieldId);
    if (!field) continue;
    const options = await choicesFor(ctx, field, field.parentFieldId ? (stored.get(field.parentFieldId) ?? "") : "");
    result.set(change.fieldId, displayStored(field, values.find((value) => value.fieldId === field.id), options));
  }
  return result;
}
