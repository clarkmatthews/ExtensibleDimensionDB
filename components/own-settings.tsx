import { HelpTip } from "@/components/help-tip";
import { saveUserOverrides } from "@/lib/access-actions";
import { LEVEL_LABEL, RIGHTS, type Level, type RightKey } from "@/lib/permission-labels";

export type OwnScreen = { id: string; label: string; section: string; inherited: Level; own: Level | null };

export type OwnDimension = {
  id: string;
  name: string;
  editable: boolean;
  inheritedData: Level | "MIXED";
  ownData: Level | "FIELDS" | null;
  inheritedRights: Record<RightKey, boolean>;
  ownRights: Record<RightKey, boolean | null>;
  fields: { id: string; friendlyName: string; inherited: Level; own: Level | null }[];
};

const fromGroups = (label: string) => `From groups (${label})`;

/**
 * A person's own settings. Everything starts at "From groups"; choosing anything else overrides
 * the groups for that one item.
 */
export function OwnSettings({
  userId,
  isAdmin,
  canEdit,
  screens,
  dimensions,
}: {
  userId: string;
  isAdmin: boolean;
  canEdit: boolean;
  screens: OwnScreen[];
  dimensions: OwnDimension[];
}) {
  const overrides =
    screens.filter((screen) => screen.own !== null).length +
    dimensions.reduce(
      (total, dimension) =>
        total +
        (dimension.ownData !== null ? 1 : 0) +
        Object.values(dimension.ownRights).filter((value) => value !== null).length +
        (dimension.ownData === "FIELDS" ? dimension.fields.filter((field) => field.own !== null).length : 0),
      0,
    );
  return (
    <form id="own-settings" action={saveUserOverrides} className="panel space-y-4 p-4">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <h2 className="flex items-center text-lg font-semibold">
          Own settings
          <HelpTip text="This person gets their groups' permissions. Change an item here only to make an exception for this person: it then overrides their groups for that item alone. From groups shows what the groups give now." />
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          This person gets what their groups allow, set on Groups. Change an item only to make an exception for them: None, View, Edit, Yes, or No overrides their groups for that item alone, including taking access away. From groups shows what their groups give now.
        </p>
        <p className="mt-1 text-sm font-semibold">
          {overrides === 0 ? "No exceptions: everything comes from groups." : overrides === 1 ? "1 exception to their groups." : `${overrides} exceptions to their groups.`}
        </p>
        {isAdmin ? <p className="mt-1 text-sm text-muted">This person is an administrator and can do everything; these settings apply only if that is removed.</p> : null}
      </div>
      <fieldset disabled={!canEdit} className="min-w-0 space-y-4 border-0 p-0">
        <section>
          <h3 className="text-sm font-semibold">Screens</h3>
          {screens.map((screen, index) => (
            <div key={screen.id}>
              {screen.section && screen.section !== screens[index - 1]?.section ? <p className="pt-2 text-xs font-semibold uppercase text-muted">{screen.section}</p> : null}
              <Row label={screen.label} changed={screen.own !== null}>
                <Choice label={screen.label} name={`nav:${screen.id}`} value={screen.own ?? "INHERIT"} inherit={fromGroups(LEVEL_LABEL[screen.inherited])} options={["NONE", "VIEW", "EDIT"]} />
              </Row>
            </div>
          ))}
        </section>
        {dimensions.map((dimension) => (
          <fieldset key={dimension.id} disabled={!dimension.editable} className="own-dimension rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{dimension.name}</legend>
            {dimension.editable ? <input type="hidden" name={`cat:${dimension.id}:shown`} value="1" /> : (
              <p className="text-xs text-muted">You need Assign permissions on this dimension to change it.</p>
            )}
            <Row label="Data" changed={dimension.ownData !== null}>
              <Choice
                label={`${dimension.name} data`}
                name={`cat:${dimension.id}:data`}
                value={dimension.ownData ?? "INHERIT"}
                inherit={fromGroups(dimension.inheritedData === "MIXED" ? "varies by attribute" : LEVEL_LABEL[dimension.inheritedData])}
                options={["NONE", "VIEW", "EDIT", "FIELDS"]}
              />
            </Row>
            <div className="own-fields ml-4">
              {dimension.fields.map((field) => (
                <Row key={field.id} label={field.friendlyName} changed={field.own !== null}>
                  <Choice label={field.friendlyName} name={`field:${field.id}:level`} value={field.own ?? "INHERIT"} inherit={fromGroups(LEVEL_LABEL[field.inherited])} options={["NONE", "VIEW", "EDIT"]} />
                </Row>
              ))}
            </div>
            {RIGHTS.map((right) => {
              const own = dimension.ownRights[right.key];
              return (
                <Row key={right.key} label={right.label} help={right.help} changed={own !== null}>
                  <Choice
                    label={`${dimension.name}: ${right.label}`}
                    name={`cat:${dimension.id}:${right.key}`}
                    value={own === null ? "INHERIT" : own ? "YES" : "NO"}
                    inherit={fromGroups(dimension.inheritedRights[right.key] ? "Yes" : "No")}
                    options={["YES", "NO"]}
                  />
                </Row>
              );
            })}
          </fieldset>
        ))}
        {canEdit ? <button className="btn" type="submit">Save own settings</button> : (
          <p className="text-sm text-muted">Edit access to Groups is required to change these.</p>
        )}
      </fieldset>
    </form>
  );
}

const CHOICE_LABEL: Record<string, string> = { ...LEVEL_LABEL, FIELDS: "Specific attributes", YES: "Yes", NO: "No" };

function Row({ label, help, changed, children }: { label: string; help?: string; changed: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-1.5 text-sm">
      <span className="flex items-center">
        {label}
        {help ? <HelpTip text={help} /> : null}
        {changed ? <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">Exception</span> : null}
      </span>
      {children}
    </div>
  );
}

function Choice({ name, label, value, inherit, options }: { name: string; label: string; value: string; inherit: string; options: string[] }) {
  return (
    <select className="field" style={{ width: "auto" }} name={name} defaultValue={value} aria-label={label}>
      <option value="INHERIT">{inherit}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {CHOICE_LABEL[option]}
        </option>
      ))}
    </select>
  );
}
