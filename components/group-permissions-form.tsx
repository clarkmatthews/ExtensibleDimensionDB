"use client";

import { useState } from "react";
import { HelpTip } from "@/components/help-tip";
import { saveGroupPermissions } from "@/lib/access-actions";
import { RIGHTS, type Level, type RightKey } from "@/lib/permission-labels";

export type GroupScreen = { id: string; label: string; section: string; level: Level };

export type GroupDimension = {
  id: string;
  name: string;
  /** False when the person saving may not grant this dimension; it is shown but not sent. */
  editable: boolean;
  level: Level;
  applyToFields: boolean;
  rights: Record<RightKey, boolean>;
  fields: { id: string; friendlyName: string; isActive: boolean; level: Level }[];
};

export function GroupPermissionsForm({
  groupId,
  screens,
  dimensions,
}: {
  groupId: string;
  screens: GroupScreen[];
  dimensions: GroupDimension[];
}) {
  const [scopes, setScopes] = useState<Record<string, "category" | "fields">>(() =>
    Object.fromEntries(dimensions.map((dimension) => [dimension.id, dimension.applyToFields ? "fields" : "category"])),
  );

  return (
    <form action={saveGroupPermissions} className="space-y-4 border-t border-line pt-3">
      <input type="hidden" name="groupId" value={groupId} />
      <section className="space-y-1">
        <h3 className="flex items-center text-sm font-semibold">
          Screens
          <HelpTip text="Members can open screens set to View, and change things on screens set to Edit. A person in several groups gets the higher level." />
        </h3>
        {screens.map((screen, index) => (
          <div key={screen.id}>
            {screen.section && screen.section !== screens[index - 1]?.section ? <p className="pt-2 text-xs font-semibold uppercase text-muted">{screen.section}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-1.5 text-sm">
              <span>{screen.label}</span>
              <LevelChoices name={`nav:${screen.id}`} level={screen.level} />
            </div>
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <h3 className="flex items-center text-sm font-semibold">
          Dimensions
          <HelpTip text="Data access lets members see (View) or change (Edit) values. Entire dimension also covers attributes added later. The admin rights let members change the dimension's definition." />
        </h3>
        {dimensions.length === 0 ? <p className="text-sm text-muted">No active dimensions yet.</p> : null}
        {dimensions.map((dimension) => {
          const specific = scopes[dimension.id] === "fields";
          return (
            <fieldset key={dimension.id} disabled={!dimension.editable} className="rounded-md border border-line p-3">
              <legend className="px-1 text-sm font-semibold">{dimension.name}</legend>
              {dimension.editable ? <input type="hidden" name={`cat:${dimension.id}:shown`} value="1" /> : (
                <p className="mb-2 text-xs text-muted">You need Assign permissions on this dimension to change it.</p>
              )}
              <p className="text-xs font-semibold uppercase text-muted">Data</p>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`cat:${dimension.id}:scope`}
                    value="category"
                    checked={!specific}
                    onChange={() => setScopes((current) => ({ ...current, [dimension.id]: "category" }))}
                  />
                  Entire dimension
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`cat:${dimension.id}:scope`}
                    value="fields"
                    checked={specific}
                    onChange={() => setScopes((current) => ({ ...current, [dimension.id]: "fields" }))}
                  />
                  Specific attributes
                </label>
              </div>
              <div className={specific ? "hidden" : ""}>
                <LevelChoices name={`cat:${dimension.id}:level`} level={dimension.level} />
              </div>
              <div className={specific ? "mt-2" : "hidden"}>
                {dimension.fields.map((field) => (
                  <div key={field.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-1.5 text-sm">
                    <span className={field.isActive ? "" : "text-muted"}>
                      {field.friendlyName}
                      {field.isActive ? "" : " (hidden)"}
                    </span>
                    <LevelChoices name={`field:${field.id}:level`} level={field.level} />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs font-semibold uppercase text-muted">Admin rights</p>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                {RIGHTS.map((right) => (
                  <label key={right.key} className="flex items-center gap-2">
                    <input type="checkbox" name={`cat:${dimension.id}:${right.key}`} defaultChecked={dimension.rights[right.key]} />
                    {right.label}
                    <HelpTip text={right.help} />
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </section>
      <button className="btn" type="submit">Save group permissions</button>
    </form>
  );
}

function LevelChoices({ name, level }: { name: string; level: Level }) {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
      {(["NONE", "VIEW", "EDIT"] as const).map((choice) => (
        <label key={choice} className="flex items-center gap-2">
          <input type="radio" name={name} value={choice} defaultChecked={level === choice} />
          {choice === "NONE" ? "None" : choice === "VIEW" ? "View" : "Edit"}
        </label>
      ))}
    </div>
  );
}
