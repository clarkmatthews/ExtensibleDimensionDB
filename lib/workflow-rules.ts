import type { TriggerOperator } from "@prisma/client";

/** Labels for the trigger conditions, in the order the page lists them. */
export const TRIGGER_OPERATORS: { value: TriggerOperator; label: string; needsValue: boolean }[] = [
  { value: "ANY", label: "Any change", needsValue: false },
  { value: "BECOMES", label: "Becomes", needsValue: true },
  { value: "CHANGES_FROM", label: "Changes from", needsValue: true },
  { value: "CONTAINS", label: "New value contains", needsValue: true },
  { value: "BECOMES_EMPTY", label: "Becomes empty", needsValue: false },
  { value: "GETS_VALUE", label: "Gets a value", needsValue: false },
];

export function parseOperator(value: unknown): TriggerOperator {
  return TRIGGER_OPERATORS.some((item) => item.value === value) ? (value as TriggerOperator) : "ANY";
}

const norm = (value: string) => value.trim().toLowerCase();

/** Whether a saved change meets a trigger's condition. Text comparisons ignore case and surrounding spaces. */
export function triggerMatches(
  trigger: { operator: TriggerOperator; matchValue: string },
  change: { oldValue: string; newValue: string },
) {
  const target = norm(trigger.matchValue);
  const before = norm(change.oldValue);
  const after = norm(change.newValue);
  switch (trigger.operator) {
    case "BECOMES":
      return after === target;
    case "CHANGES_FROM":
      return before === target && after !== target;
    case "CONTAINS":
      return target !== "" && after.includes(target);
    case "BECOMES_EMPTY":
      return before !== "" && after === "";
    case "GETS_VALUE":
      return before === "" && after !== "";
    default:
      return true;
  }
}

type CheckedWorkflow = {
  kind: "NOTIFY" | "TASK";
  isActive: boolean;
  onCreate: boolean;
  onChange: boolean;
  manual: boolean;
  categoryIds: string[];
  triggers: { fieldId: string; categoryId: string; operator: TriggerOperator; matchValue: string }[];
  recipientCount: number;
  steps: { kind: "ACTION" | "NOTIFY"; groupId: string | null; assigneeUserId: string | null }[];
  /** Record type of each dimension, by dimension id. */
  typeOfCategory: Map<string, string>;
};

/** Setups that save without error but can never do anything. Shown on the workflow so they are fixed. */
export function workflowProblems(workflow: CheckedWorkflow): string[] {
  const problems: string[] = [];
  const manual = workflow.kind === "TASK" && workflow.manual;
  if (!workflow.onCreate && !workflow.onChange && !manual) {
    problems.push(workflow.kind === "TASK" ? "Nothing starts it: turn on Record created, Attribute change, or Manual start." : "Nothing starts it: turn on Record created or Attribute change.");
  }
  if (workflow.onChange && workflow.triggers.length === 0) {
    problems.push("Attribute change is on, but no attributes are chosen, so a change never starts it.");
  }
  if (workflow.kind === "NOTIFY" && workflow.recipientCount === 0) {
    problems.push("No groups or people are chosen to notify.");
  }
  if (workflow.kind === "TASK" && workflow.steps.length === 0) {
    problems.push("It has no steps yet.");
  }
  if (workflow.kind === "TASK" && workflow.steps.length > 0 && workflow.steps.every((step) => step.kind === "NOTIFY")) {
    problems.push("Every step is a notice, so nothing is ever assigned. Use a Notify workflow, or add an action step.");
  }
  if (workflow.kind === "TASK" && workflow.steps.some((step) => step.kind === "ACTION" && !step.groupId)) {
    problems.push("An action step has no group.");
  }
  if (workflow.categoryIds.length && workflow.triggers.some((trigger) => !workflow.categoryIds.includes(trigger.categoryId))) {
    problems.push("Some trigger attributes are outside the chosen dimensions, so their changes are ignored.");
  }
  const types = new Set([
    ...workflow.categoryIds.map((id) => workflow.typeOfCategory.get(id)),
    ...workflow.triggers.map((trigger) => workflow.typeOfCategory.get(trigger.categoryId)),
  ].filter(Boolean));
  if (types.size > 1) problems.push("Its dimensions and attributes come from more than one record type. Check that is intended.");
  const needsValue = workflow.triggers.filter((trigger) => ["BECOMES", "CHANGES_FROM", "CONTAINS"].includes(trigger.operator) && !trigger.matchValue.trim());
  if (needsValue.length) problems.push("A trigger condition needs a value to compare with.");
  return workflow.isActive ? problems : problems.length ? ["It is inactive.", ...problems] : [];
}
