import { describe, expect, it } from "vitest";
import { triggerMatches, workflowProblems } from "@/lib/workflow-rules";

const change = (oldValue: string, newValue: string) => ({ oldValue, newValue });

describe("trigger conditions", () => {
  it("any change always matches", () => {
    expect(triggerMatches({ operator: "ANY", matchValue: "" }, change("a", "b"))).toBe(true);
  });
  it("becomes ignores case and spaces", () => {
    expect(triggerMatches({ operator: "BECOMES", matchValue: "Closed " }, change("Open", "closed"))).toBe(true);
    expect(triggerMatches({ operator: "BECOMES", matchValue: "Closed" }, change("Open", "Closing"))).toBe(false);
  });
  it("changes from needs the old value and a different new one", () => {
    expect(triggerMatches({ operator: "CHANGES_FROM", matchValue: "active" }, change("Active", "Inactive"))).toBe(true);
    expect(triggerMatches({ operator: "CHANGES_FROM", matchValue: "active" }, change("Pending", "Inactive"))).toBe(false);
  });
  it("contains looks in the new value, and an empty value never matches", () => {
    expect(triggerMatches({ operator: "CONTAINS", matchValue: "produce" }, change("", "Pacific Produce Co"))).toBe(true);
    expect(triggerMatches({ operator: "CONTAINS", matchValue: "" }, change("", "anything"))).toBe(false);
  });
  it("becomes empty and gets a value", () => {
    expect(triggerMatches({ operator: "BECOMES_EMPTY", matchValue: "" }, change("555-0100", ""))).toBe(true);
    expect(triggerMatches({ operator: "BECOMES_EMPTY", matchValue: "" }, change("", ""))).toBe(false);
    expect(triggerMatches({ operator: "GETS_VALUE", matchValue: "" }, change("", "x"))).toBe(true);
    expect(triggerMatches({ operator: "GETS_VALUE", matchValue: "" }, change("y", "x"))).toBe(false);
  });
});

const base = {
  kind: "TASK" as const,
  isActive: true,
  onCreate: false,
  onChange: false,
  manual: true,
  categoryIds: [] as string[],
  triggers: [] as { fieldId: string; categoryId: string; operator: "ANY" | "BECOMES"; matchValue: string }[],
  recipientCount: 0,
  steps: [{ kind: "ACTION" as const, groupId: "g1", assigneeUserId: null }],
  typeOfCategory: new Map([["c-loc", "location"], ["c-ven", "vendor"]]),
};

describe("workflows that can never run", () => {
  it("a sound workflow has no problems", () => {
    expect(workflowProblems(base)).toEqual([]);
  });
  it("flags no trigger, attribute change without attributes, no recipients, no steps", () => {
    expect(workflowProblems({ ...base, manual: false })[0]).toContain("Nothing starts it");
    expect(workflowProblems({ ...base, onChange: true }).join(" ")).toContain("no attributes are chosen");
    expect(workflowProblems({ ...base, kind: "NOTIFY", onCreate: true }).join(" ")).toContain("No groups or people");
    expect(workflowProblems({ ...base, steps: [] }).join(" ")).toContain("no steps");
  });
  it("flags triggers outside the chosen dimensions and mixed record types", () => {
    const problems = workflowProblems({
      ...base,
      onChange: true,
      categoryIds: ["c-loc"],
      triggers: [{ fieldId: "f1", categoryId: "c-ven", operator: "ANY", matchValue: "" }],
    }).join(" ");
    expect(problems).toContain("outside the chosen dimensions");
    expect(problems).toContain("more than one record type");
  });
  it("flags a comparison with no value, and stays quiet when inactive and sound", () => {
    expect(workflowProblems({ ...base, onChange: true, triggers: [{ fieldId: "f", categoryId: "c-loc", operator: "BECOMES", matchValue: " " }] }).join(" ")).toContain("needs a value");
    expect(workflowProblems({ ...base, isActive: false })).toEqual([]);
  });
});
