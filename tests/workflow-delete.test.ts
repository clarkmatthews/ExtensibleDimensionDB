import { describe, expect, it, vi } from "vitest";
import { deleteWorkflowStepGraph, previewWorkflowDelete, previewWorkflowStepDelete } from "@/lib/workflow-delete";

function db(overrides: Record<string, Record<string, unknown>>) {
  const base = {
    workflowStep: { findUnique: vi.fn(), delete: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn() },
    workflowProcess: { findUnique: vi.fn(), delete: vi.fn() },
    task: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), deleteMany: vi.fn() },
    notification: { updateMany: vi.fn() },
    storeProcess: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), deleteMany: vi.fn() },
  };
  for (const [model, fns] of Object.entries(overrides)) Object.assign(base[model as keyof typeof base], fns);
  return base as never;
}

describe("deleting workflow steps", () => {
  it("refuses while a record is waiting on the step, and deletes nothing", async () => {
    const remove = vi.fn();
    const client = db({
      workflowStep: { findUnique: vi.fn(async () => ({ id: "s1", name: "Approve vendor", processId: "p1", process: { name: "Onboarding" } })), delete: remove },
      task: { count: vi.fn(async () => 2) },
    });
    const preview = await previewWorkflowStepDelete(client, "s1");
    expect(preview.error).toContain("2 records are waiting on this step");
    expect(preview.message).toBe("");
    expect(await deleteWorkflowStepGraph(client, "s1")).toContain("waiting");
    expect(remove).not.toHaveBeenCalled();
  });

  it("says how much finished history goes with the step", async () => {
    const client = db({
      workflowStep: { findUnique: vi.fn(async () => ({ id: "s1", name: "Approve vendor", processId: "p1", process: { name: "Onboarding" } })) },
      task: { count: vi.fn(async (args: { where: { completedAt?: null } }) => ("completedAt" in args.where ? 0 : 3)) },
    });
    const preview = await previewWorkflowStepDelete(client, "s1");
    expect(preview.error).toBe("");
    expect(preview.message).toContain("3 completed actions");
  });
});

describe("deleting workflows", () => {
  it("names open records and points to Active as the way to keep history", async () => {
    const client = db({
      workflowProcess: { findUnique: vi.fn(async () => ({ id: "p1", name: "Onboarding", _count: { steps: 3 } })) },
      storeProcess: { count: vi.fn(async (args: { where: { status?: unknown } }) => ("status" in args.where ? 1 : 4)) },
    });
    const preview = await previewWorkflowDelete(client, "p1");
    expect(preview.message).toContain("its 3 steps");
    expect(preview.message).toContain("1 record still has it open");
    expect(preview.message).toContain("history of 4 runs");
    expect(preview.message).toContain("clear Active");
  });
});
