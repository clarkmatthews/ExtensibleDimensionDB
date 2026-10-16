import type { Prisma, SubjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** The parts of a person's access that row scope needs. */
export type ScopeAccess = {
  user: { id: string; isAdmin: boolean };
  groupIds?: string[];
  rowScope?: RowScopeData;
};

/**
 * Row access on top of attribute access. A scope lists rules for the record types it limits.
 * A type with no rule, and a person with no scope, still sees every row. Administrators are
 * never limited. Several scopes, and several rules for one type, are combined: a row is
 * visible when any of them matches.
 */

/** Attributes a rule may match. Numbers, dates, files, and checkboxes are not rule targets. */
export const SCOPE_ATTRIBUTE_TYPES = [
  "TEXT",
  "BIG_TEXT",
  "RADIO",
  "DROPDOWN",
  "ZIPCODE",
  "ADDRESS",
  "EMAIL",
  "PHONE",
  "COORDINATE",
  "TIME",
  "RECORD_LINK",
] as const;

export type ScopeRuleKind = "RECORDS" | "ATTRIBUTE";

/**
 * How a rule compares values. Choices and links compare their stored keys; phone numbers and ZIP
 * codes compare digits only, so "(213) 555-0123" matches "213-555-0123"; other text ignores case
 * and extra spaces, so "west " matches "West".
 */
export type ScopeMatch = "key" | "digits" | "text";

export function matchFor(dataType: string | null | undefined): ScopeMatch {
  if (dataType === "RADIO" || dataType === "DROPDOWN" || dataType === "RECORD_LINK") return "key";
  if (dataType === "PHONE" || dataType === "ZIPCODE") return "digits";
  return "text";
}

/** A value in the form a rule compares. */
export function normalizeScopeValue(value: string, match: ScopeMatch): string {
  const trimmed = value.trim();
  if (match === "key") return trimmed;
  if (match === "digits") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits) return digits;
  }
  return trimmed.normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

export type ScopeRuleView = {
  id: string;
  scopeId: string;
  recordTypeId: string;
  kind: ScopeRuleKind;
  fieldId: string | null;
  /**
   * The attribute holds a pipe-separated list (a record link, or a list that allows several
   * choices), so the row matches when any piece is accepted.
   */
  split: boolean;
  /** How values are compared. */
  match: ScopeMatch;
  /** The rule's attribute was deleted, so the rule matches nothing. */
  fieldMissing?: boolean;
  sourceRuleId: string | null;
  recordIds: string[];
  values: string[];
};

export type RowScopeData = {
  assignments: { scopeId: string; subjectType: SubjectType; subjectId: string }[];
  scopes: { id: string; isActive: boolean }[];
  rules: ScopeRuleView[];
};

export const EMPTY_ROW_SCOPE: RowScopeData = { assignments: [], scopes: [], rules: [] };

export const LEAVES_SCOPE = "This change would move the record outside your scope.";
export const CREATE_SCOPE = "A new record must match your scope.";
/** The create error, naming the attributes a new record would have to set. */
export function createScopeMessage(attributes: string[]) {
  if (!attributes.length) return `${CREATE_SCOPE} Your scope only lists existing records, so you cannot add new ones here.`;
  return `${CREATE_SCOPE} Set ${attributes.join(" or ")} to a value your scope allows.`;
}
export const OUTSIDE_SCOPE = "This record is outside your scope.";

type StoredValue = { locationId: string; fieldId: string; valueText: string | null };

const resolvedIds = new WeakMap<ScopeAccess, Map<string, Promise<string[] | null>>>();

export function assignedScopeIds(userId: string, groupIds: string[], data: RowScopeData): Set<string> {
  const active = new Set(data.scopes.filter((scope) => scope.isActive).map((scope) => scope.id));
  const ids = new Set<string>();
  for (const row of data.assignments) {
    if (!active.has(row.scopeId)) continue;
    if (row.subjectType === "USER" && row.subjectId === userId) ids.add(row.scopeId);
    if (row.subjectType === "GROUP" && groupIds.includes(row.subjectId)) ids.add(row.scopeId);
  }
  return ids;
}

function scopeData(access: ScopeAccess): RowScopeData {
  return access.rowScope ?? EMPTY_ROW_SCOPE;
}

/** Rules that limit this record type for this person. None means every row is visible. */
export function rulesFor(access: ScopeAccess, recordTypeId: string): ScopeRuleView[] {
  if (access.user.isAdmin) return [];
  const data = scopeData(access);
  const scopes = assignedScopeIds(access.user.id, access.groupIds ?? [], data);
  return data.rules.filter((rule) => rule.recordTypeId === recordTypeId && scopes.has(rule.scopeId));
}

/** Record types this person does not see in full. */
export function restrictedRecordTypeIds(access: ScopeAccess): string[] {
  if (access.user.isAdmin) return [];
  const data = scopeData(access);
  const scopes = assignedScopeIds(access.user.id, access.groupIds ?? [], data);
  return [...new Set(data.rules.filter((rule) => scopes.has(rule.scopeId)).map((rule) => rule.recordTypeId))];
}

/**
 * Values a rule accepts, in compared form: its own list, plus the records of the rule it points at.
 * A rule whose attribute is gone accepts nothing.
 */
export function acceptedValues(rule: ScopeRuleView, rules: ScopeRuleView[]): Set<string> {
  const accepted = new Set<string>();
  if (rule.fieldMissing) return accepted;
  for (const value of rule.values) {
    const normalized = normalizeScopeValue(value, rule.match);
    if (normalized) accepted.add(normalized);
  }
  if (!rule.sourceRuleId) return accepted;
  const source = rules.find((item) => item.id === rule.sourceRuleId && item.scopeId === rule.scopeId && item.kind === "RECORDS");
  for (const id of source?.recordIds ?? []) if (id) accepted.add(id);
  return accepted;
}

/**
 * True when a stored attribute equals an accepted value (already normalized with the same
 * match). A list attribute matches when any piece of its pipe-separated value is accepted.
 */
export function storedMatches(
  stored: string | null | undefined,
  accepted: ReadonlySet<string>,
  options: { split: boolean; match: ScopeMatch },
): boolean {
  const raw = stored ?? "";
  if (!raw.trim() || accepted.size === 0) return false;
  const pieces = options.split ? raw.split("|") : [raw];
  return pieces.some((piece) => {
    const normalized = normalizeScopeValue(piece, options.match);
    return Boolean(normalized) && accepted.has(normalized);
  });
}

/**
 * Rows matched by these rules. An empty rule matches nothing. Record rules and attribute rules
 * are combined. `catalog` is every rule in the person's scopes, so an attribute rule can use a
 * record list from another record type.
 */
export function matchingLocationIds(rules: ScopeRuleView[], values: StoredValue[], catalog: ScopeRuleView[] = rules): Set<string> {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (rule.kind === "RECORDS") {
      for (const id of rule.recordIds) if (id) ids.add(id);
      continue;
    }
    if (!rule.fieldId || rule.fieldMissing) continue;
    const accepted = acceptedValues(rule, catalog);
    if (!accepted.size) continue;
    for (const value of values) {
      if (value.fieldId !== rule.fieldId) continue;
      if (storedMatches(value.valueText, accepted, rule)) ids.add(value.locationId);
    }
  }
  return ids;
}

/**
 * True when this record, with these resulting attribute values, still satisfies the rules.
 * A new record has no id, so only an attribute rule can allow it.
 */
export function rowMatches(
  rules: ScopeRuleView[],
  locationId: string | null,
  values: ReadonlyMap<string, string>,
  catalog: ScopeRuleView[] = rules,
): boolean {
  if (!rules.length) return true;
  for (const rule of rules) {
    if (rule.kind === "RECORDS") {
      if (locationId && rule.recordIds.includes(locationId)) return true;
      continue;
    }
    if (!rule.fieldId || rule.fieldMissing) continue;
    const accepted = acceptedValues(rule, catalog);
    if (storedMatches(values.get(rule.fieldId) ?? "", accepted, rule)) return true;
  }
  return false;
}

/** Every rule in the scopes that apply to this person, including other record types. */
function scopeCatalog(access: ScopeAccess): ScopeRuleView[] {
  if (access.user.isAdmin) return [];
  const data = scopeData(access);
  const scopes = assignedScopeIds(access.user.id, access.groupIds ?? [], data);
  return data.rules.filter((rule) => scopes.has(rule.scopeId));
}

/** True when saving this record would leave it visible to this person. No rules means yes. */
export function staysInScope(access: ScopeAccess, recordTypeId: string, locationId: string | null, values: ReadonlyMap<string, string>) {
  return rowMatches(rulesFor(access, recordTypeId), locationId, values, scopeCatalog(access));
}

/**
 * Attributes that could let this person add a record of this type: those of their working
 * attribute rules. Null when the type is not limited, so any new record is allowed. An empty
 * list means their scope only names existing records, so they cannot add one.
 */
export function creatableFieldIds(access: ScopeAccess, recordTypeId: string): string[] | null {
  const rules = rulesFor(access, recordTypeId);
  if (!rules.length) return null;
  const catalog = scopeCatalog(access);
  const ids = rules.flatMap((rule) =>
    rule.kind === "ATTRIBUTE" && rule.fieldId && !rule.fieldMissing && acceptedValues(rule, catalog).size ? [rule.fieldId] : [],
  );
  return [...new Set(ids)];
}

export async function loadRowScope(): Promise<RowScopeData> {
  const [scopes, assignments, rules] = await Promise.all([
    prisma.scope.findMany({ select: { id: true, isActive: true } }),
    prisma.scopeAssignment.findMany({ select: { scopeId: true, subjectType: true, subjectId: true } }),
    prisma.scopeRule.findMany({
      include: {
        field: { select: { dataType: true, multiple: true } },
        records: { select: { locationId: true } },
        values: { select: { valueText: true } },
      },
    }),
  ]);
  return {
    scopes,
    assignments,
    rules: rules.map((rule) => ({
      id: rule.id,
      scopeId: rule.scopeId,
      recordTypeId: rule.recordTypeId,
      kind: rule.kind,
      fieldId: rule.fieldId,
      split: rule.field?.dataType === "RECORD_LINK" || (rule.field?.dataType === "DROPDOWN" && rule.field.multiple),
      match: matchFor(rule.field?.dataType),
      fieldMissing: rule.kind === "ATTRIBUTE" && !rule.field,
      sourceRuleId: rule.sourceRuleId,
      recordIds: rule.records.map((row) => row.locationId),
      values: rule.values.map((row) => row.valueText),
    })),
  };
}

/**
 * Ids this person may see of one record type, or null when the type is not limited.
 * The result is remembered for the rest of this access value.
 */
export function allowedIds(access: ScopeAccess, recordTypeId: string): Promise<string[] | null> {
  let cache = resolvedIds.get(access);
  if (!cache) {
    cache = new Map();
    resolvedIds.set(access, cache);
  }
  const cached = cache.get(recordTypeId);
  if (cached) return cached;
  const pending = resolveAllowedIds(access, recordTypeId);
  cache.set(recordTypeId, pending);
  return pending;
}

async function resolveAllowedIds(access: ScopeAccess, recordTypeId: string): Promise<string[] | null> {
  const rules = rulesFor(access, recordTypeId);
  if (!rules.length) return null;
  const listed = [...new Set(rules.flatMap((rule) => (rule.kind === "RECORDS" ? rule.recordIds : [])))];
  const fieldIds = [...new Set(rules.flatMap((rule) => (rule.kind === "ATTRIBUTE" && rule.fieldId ? [rule.fieldId] : [])))];
  const [validRows, values] = await Promise.all([
    listed.length
      ? prisma.location.findMany({ where: { id: { in: listed }, recordTypeId }, select: { id: true } })
      : Promise.resolve([]),
    fieldIds.length
      ? prisma.fieldValue.findMany({
          where: { fieldId: { in: fieldIds }, location: { recordTypeId } },
          select: { locationId: true, fieldId: true, valueText: true },
        })
      : Promise.resolve([]),
  ]);
  const valid = new Set(validRows.map((row) => row.id));
  const checked = rules.map((rule) =>
    rule.kind === "RECORDS" ? { ...rule, recordIds: rule.recordIds.filter((id) => valid.has(id)) } : rule,
  );
  return [...matchingLocationIds(checked, values, scopeCatalog(access))];
}

/** A location filter for queries that span record types. Undefined when nothing is limited. */
export async function locationConstraint(access: ScopeAccess): Promise<Prisma.LocationWhereInput | undefined> {
  const restricted = restrictedRecordTypeIds(access);
  if (!restricted.length) return undefined;
  const ids: string[] = [];
  for (const recordTypeId of restricted) ids.push(...((await allowedIds(access, recordTypeId)) ?? []));
  return { OR: [{ recordTypeId: { notIn: restricted } }, { id: { in: ids } }] };
}

/**
 * A notice filter that leaves out notices about records outside this person's scope, whether the
 * record is named on the notice or reached through its change or action. Undefined when nothing
 * is limited. The unread count and the dashboard use the same filter, so they agree.
 */
export async function noticeConstraint(access: ScopeAccess): Promise<Prisma.NotificationWhereInput | undefined> {
  const scope = await locationConstraint(access);
  if (!scope) return undefined;
  return {
    OR: [
      { locationId: { not: null }, location: scope },
      { locationId: null, fieldChangeId: { not: null }, fieldChange: { location: scope } },
      { locationId: null, fieldChangeId: null, taskId: { not: null }, task: { storeProcess: { location: scope } } },
      { locationId: null, fieldChangeId: null, taskId: null },
    ],
  };
}

/** True when this record is one the person may see. A missing record is not. */
export async function locationVisible(access: ScopeAccess, locationId: string): Promise<boolean> {
  if (!locationId) return false;
  if (access.user.isAdmin) return true;
  const location = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true, recordTypeId: true } });
  if (!location) return false;
  const allowed = await allowedIds(access, location.recordTypeId);
  return !allowed || allowed.includes(location.id);
}

/** The ids from this list that the person may see. */
export async function filterVisibleIds(access: ScopeAccess, locationIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(locationIds.filter(Boolean))];
  if (!unique.length) return new Set();
  if (access.user.isAdmin || restrictedRecordTypeIds(access).length === 0) return new Set(unique);
  const rows = await prisma.location.findMany({
    where: { id: { in: unique } },
    select: { id: true, recordTypeId: true },
  });
  const allowedByType = new Map<string, string[] | null>();
  const visible = new Set<string>();
  for (const row of rows) {
    let allowed = allowedByType.get(row.recordTypeId);
    if (allowed === undefined) {
      allowed = await allowedIds(access, row.recordTypeId);
      allowedByType.set(row.recordTypeId, allowed);
    }
    if (!allowed || allowed.includes(row.id)) visible.add(row.id);
  }
  return visible;
}

type ProposalRow = { locationId: string | null; recordTypeId: string; changes: unknown };

/** Drops proposals whose record is outside the scope. A new record stays when its values would match. */
export async function visibleProposals<T extends ProposalRow>(access: ScopeAccess, rows: T[]): Promise<T[]> {
  const visible = await filterVisibleIds(
    access,
    rows.flatMap((row) => (row.locationId ? [row.locationId] : [])),
  );
  return rows.filter((row) => {
    if (row.locationId) return visible.has(row.locationId);
    const rules = rulesFor(access, row.recordTypeId);
    if (!rules.length) return true;
    const changes = Array.isArray(row.changes) ? row.changes : [];
    const values = new Map<string, string>();
    for (const change of changes) {
      if (change && typeof change === "object" && "fieldId" in change && "input" in change) {
        values.set(String(change.fieldId), String(change.input ?? ""));
      }
    }
    return rowMatches(rules, null, values, scopeCatalog(access));
  });
}

/**
 * The people in this list who may see this record, for notices about it. Inactive people are
 * dropped. People whose scopes do not limit the record's type always may.
 */
export async function usersWhoCanSee(userIds: string[], locationId: string): Promise<string[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length || !locationId) return [];
  const [location, users, data] = await Promise.all([
    prisma.location.findUnique({ where: { id: locationId }, select: { id: true, recordTypeId: true } }),
    prisma.user.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true, isAdmin: true, groups: { select: { groupId: true } } } }),
    loadRowScope(),
  ]);
  if (!location) return [];
  // People with the same scopes see the same rows, so each set of scopes is resolved once.
  const verdicts = new Map<string, Promise<boolean>>();
  const allowed: string[] = [];
  for (const user of users) {
    const access: ScopeAccess = { user, groupIds: user.groups.map((row) => row.groupId), rowScope: data };
    const rules = rulesFor(access, location.recordTypeId);
    if (!rules.length) {
      allowed.push(user.id);
      continue;
    }
    const key = [...assignedScopeIds(user.id, access.groupIds ?? [], data)].sort().join(",");
    let verdict = verdicts.get(key);
    if (!verdict) {
      verdict = allowedIds(access, location.recordTypeId).then((ids) => !ids || ids.includes(location.id));
      verdicts.set(key, verdict);
    }
    if (await verdict) allowed.push(user.id);
  }
  return allowed;
}
