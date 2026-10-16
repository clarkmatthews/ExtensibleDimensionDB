import { HelpTip } from "@/components/help-tip";
import { saveSubjectScopes } from "@/lib/scope-actions";

export type AssignableScope = { id: string; name: string; isActive: boolean };

/**
 * Scopes assigned directly to a group or a person. A person's direct scopes are added to the
 * scopes from their groups; they do not replace them.
 */
export function ScopeAssignments({
  subjectType,
  subjectId,
  returnTo,
  scopes,
  assignedIds,
  inherited,
  canEdit,
  divider = true,
}: {
  subjectType: "GROUP" | "USER";
  subjectId: string;
  returnTo: string;
  scopes: AssignableScope[];
  assignedIds: string[];
  inherited: string[];
  canEdit: boolean;
  divider?: boolean;
}) {
  const assigned = new Set(assignedIds);
  return (
    <form action={saveSubjectScopes} className={`space-y-2 ${divider ? "border-t border-line pt-3" : ""}`}>
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <h3 className="flex items-center text-sm font-semibold">
        Scopes
        <HelpTip text="A scope limits which records can be seen for the record types it names. Record types it does not name stay fully visible. Several scopes are combined. A scope chosen on a person's page is added to the scopes from their groups." />
      </h3>
      {inherited.length ? <p className="text-sm text-muted">From groups: {inherited.join(", ")}</p> : null}
      {scopes.length === 0 ? <p className="text-sm text-muted">No scopes yet. Create one on Scopes.</p> : (
        <div className="flex flex-wrap gap-3 text-sm">
          {scopes.map((scope) => (
            <label key={scope.id} className="flex items-center gap-2">
              <input type="checkbox" name="scopeId" value={scope.id} defaultChecked={assigned.has(scope.id)} disabled={!canEdit} />
              {scope.name}
              {scope.isActive ? "" : " (disabled)"}
            </label>
          ))}
        </div>
      )}
      {canEdit && scopes.length ? <button className="btn" type="submit">Save scopes</button> : null}
    </form>
  );
}
