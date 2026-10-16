import { describe, expect, it } from "vitest";
import type { AccessContext } from "@/lib/permissions";
import { canUpdateField, type LoadedField } from "@/lib/record-save";
import {
  acceptedValues,
  assignedScopeIds,
  matchingLocationIds,
  restrictedRecordTypeIds,
  rowMatches,
  rulesFor,
  staysInScope,
  storedMatches,
  type RowScopeData,
  type ScopeAccess,
  type ScopeRuleView,
} from "@/lib/row-scope";

const locations = "locations";
const products = "products";
const vendors = "vendors";

function rule(extra: Partial<ScopeRuleView> & Pick<ScopeRuleView, "id" | "scopeId" | "recordTypeId" | "kind">): ScopeRuleView {
  return { fieldId: null, link: false, sourceRuleId: null, recordIds: [], values: [], ...extra };
}

const westLocations = rule({ id: "west-locations", scopeId: "west", recordTypeId: locations, kind: "RECORDS", recordIds: ["sea", "pdx", "den"] });
const eastLocations = rule({ id: "east-locations", scopeId: "east", recordTypeId: locations, kind: "RECORDS", recordIds: ["bos"] });
const productLink = rule({
  id: "west-products",
  scopeId: "west",
  recordTypeId: products,
  kind: "ATTRIBUTE",
  fieldId: "location",
  link: true,
  sourceRuleId: "west-locations",
});
const region = rule({ id: "west-region", scopeId: "west", recordTypeId: locations, kind: "ATTRIBUTE", fieldId: "region", values: ["West"] });

function data(rules: ScopeRuleView[], assignments: RowScopeData["assignments"], scopes: RowScopeData["scopes"] = [
  { id: "west", isActive: true },
  { id: "east", isActive: true },
  { id: "paused", isActive: false },
]): RowScopeData {
  return { assignments, scopes, rules };
}

function person(rowScope: RowScopeData, extra: Partial<ScopeAccess> = {}): ScopeAccess {
  return { user: { id: "pat", isAdmin: false }, groupIds: ["managers"], rowScope, ...extra };
}

describe("row scopes", () => {
  it("leaves every row visible when there is no scope", () => {
    const access = person(data([], []));
    expect(rulesFor(access, locations)).toEqual([]);
    expect(restrictedRecordTypeIds(access)).toEqual([]);
    expect(staysInScope(access, locations, null, new Map())).toBe(true);
    expect(matchingLocationIds([], [])).toEqual(new Set());
  });

  it("limits only the record types a scope mentions", () => {
    const access = person(data([westLocations], [{ scopeId: "west", subjectType: "GROUP", subjectId: "managers" }]));
    expect(rulesFor(access, locations).map((item) => item.id)).toEqual(["west-locations"]);
    expect(rulesFor(access, vendors)).toEqual([]);
    expect(restrictedRecordTypeIds(access)).toEqual([locations]);
    expect(matchingLocationIds(rulesFor(access, locations), [])).toEqual(new Set(["sea", "pdx", "den"]));
  });

  it("unions scopes and does not let a group with no scope widen the rows", () => {
    const assignments = [
      { scopeId: "west", subjectType: "GROUP" as const, subjectId: "managers" },
      { scopeId: "east", subjectType: "GROUP" as const, subjectId: "east-team" },
    ];
    const rules = [westLocations, eastLocations];
    const both = person(data(rules, assignments), { groupIds: ["managers", "east-team", "everyone"] });
    expect([...matchingLocationIds(rulesFor(both, locations), [])].sort()).toEqual(["bos", "den", "pdx", "sea"]);
    const onlyWest = person(data(rules, assignments), { groupIds: ["managers", "everyone"] });
    expect([...matchingLocationIds(rulesFor(onlyWest, locations), [])].sort()).toEqual(["den", "pdx", "sea"]);
    expect(assignedScopeIds("pat", ["everyone"], data(rules, assignments)).size).toBe(0);
  });

  it("adds a scope assigned to the person without replacing group scopes", () => {
    const rowScope = data(
      [westLocations, eastLocations],
      [
        { scopeId: "west", subjectType: "GROUP", subjectId: "managers" },
        { scopeId: "east", subjectType: "USER", subjectId: "pat" },
      ],
    );
    expect([...assignedScopeIds("pat", ["managers"], rowScope)].sort()).toEqual(["east", "west"]);
    expect(rulesFor(person(rowScope), locations)).toHaveLength(2);
  });

  it("ignores a disabled scope and an empty rule", () => {
    const paused = rule({ id: "paused-locations", scopeId: "paused", recordTypeId: locations, kind: "RECORDS", recordIds: ["sea"] });
    const empty = rule({ id: "empty", scopeId: "west", recordTypeId: locations, kind: "RECORDS", recordIds: [] });
    const access = person(data([paused, empty], [
      { scopeId: "paused", subjectType: "GROUP", subjectId: "managers" },
      { scopeId: "west", subjectType: "GROUP", subjectId: "managers" },
    ]));
    expect(rulesFor(access, locations).map((item) => item.id)).toEqual(["empty"]);
    expect(matchingLocationIds(rulesFor(access, locations), [])).toEqual(new Set());
    expect(rowMatches(rulesFor(access, locations), "sea", new Map())).toBe(false);
  });

  it("matches a link when any piece of the stored value is accepted, and follows another rule's records", () => {
    expect(storedMatches("sea|bos", new Set(["sea"]), true)).toBe(true);
    expect(storedMatches("bos", new Set(["sea"]), true)).toBe(false);
    expect(storedMatches("West", new Set(["West"]), false)).toBe(true);
    expect(storedMatches("west", new Set(["West"]), false)).toBe(false);
    const rules = [westLocations, productLink];
    expect(acceptedValues(productLink, rules)).toEqual(new Set(["sea", "pdx", "den"]));
    const values = [
      { locationId: "mug", fieldId: "location", valueText: "sea|bos" },
      { locationId: "hat", fieldId: "location", valueText: "bos" },
    ];
    const productRules = rules.filter((item) => item.recordTypeId === products);
    expect(matchingLocationIds(productRules, values, rules)).toEqual(new Set(["mug"]));
    const access = person(data(rules, [{ scopeId: "west", subjectType: "GROUP", subjectId: "managers" }]));
    expect(staysInScope(access, products, null, new Map([["location", "sea"]]))).toBe(true);
    expect(staysInScope(access, products, null, new Map([["location", "bos"]]))).toBe(false);
    expect(staysInScope(access, products, "mug", new Map([["location", "sea|bos"]]))).toBe(true);
  });

  it("allows a new record only when an attribute rule matches, and rejects a change that leaves the scope", () => {
    const recordsOnly = [westLocations];
    expect(rowMatches(recordsOnly, null, new Map([["region", "West"]]))).toBe(false);
    expect(rowMatches(recordsOnly, "sea", new Map())).toBe(true);
    expect(rowMatches([region], null, new Map([["region", "West"]]))).toBe(true);
    expect(rowMatches([region], "sea", new Map([["region", "East"]]))).toBe(false);
    const access = person(data([region], [{ scopeId: "west", subjectType: "GROUP", subjectId: "managers" }]));
    expect(staysInScope(access, locations, null, new Map([["region", "West"]]))).toBe(true);
    expect(staysInScope(access, locations, "sea", new Map([["region", "East"]]))).toBe(false);
    expect(staysInScope(access, vendors, "acme", new Map())).toBe(true);
  });

  it("does not limit an administrator", () => {
    const access = person(
      data([westLocations], [{ scopeId: "west", subjectType: "USER", subjectId: "pat" }]),
      { user: { id: "pat", isAdmin: true } },
    );
    expect(rulesFor(access, locations)).toEqual([]);
    expect(restrictedRecordTypeIds(access)).toEqual([]);
    expect(staysInScope(access, locations, "nyc", new Map())).toBe(true);
  });

  it("still requires attribute edit on a row the scope allows", () => {
    const rowScope = data([westLocations], [{ scopeId: "west", subjectType: "GROUP", subjectId: "managers" }]);
    const access = {
      user: { id: "pat", isAdmin: false, groups: [{ groupId: "managers" }] },
      groupIds: ["managers"],
      categoryPerms: [],
      fieldPerms: [],
      modulePerms: [],
      rowScope,
    } as unknown as AccessContext;
    expect(staysInScope(access, locations, "sea", new Map())).toBe(true);
    expect(canUpdateField(access, { id: "name", categoryId: "cat", isCreatedDate: false } as LoadedField)).toBe(false);
  });
});
