"use client";

import { useState } from "react";
import { HelpTip } from "@/components/help-tip";
import { saveGroupAccess } from "@/lib/access-actions";

export type GroupAccessLevel = "NONE" | "VIEW" | "EDIT";

export type GroupAccessCategory = {
  id: string;
  name: string;
  grantLevel: GroupAccessLevel;
  applyToFields: boolean;
  fields: { id: string; friendlyName: string; isActive: boolean; level: GroupAccessLevel }[];
};

export function GroupAccessForm({
  groupId,
  categories,
}: {
  groupId: string;
  categories: GroupAccessCategory[];
}) {
  const [scopes, setScopes] = useState<Record<string, "category" | "fields">>(() =>
    Object.fromEntries(categories.map((category) => [category.id, category.applyToFields ? "fields" : "category"])),
  );

  return (
    <form action={saveGroupAccess} className="space-y-3 border-t border-line pt-3">
      <input type="hidden" name="groupId" value={groupId} />
      <div>
        <h3 className="flex items-center text-sm font-semibold">
          Dimension access
          <HelpTip text="View can see an attribute. Edit can change it. None grants nothing from this group, so a department grant can still apply. Specific attributes with None blocks the department for those attributes." />
        </h3>
        <p className="mt-1 text-sm text-muted">
          Members receive this access. View can see an attribute. Edit can change it. None grants nothing from this group, so a department grant can still apply. Entire dimension covers attributes added later.
        </p>
      </div>
      {categories.length === 0 ? <p className="text-sm text-muted">No active dimensions yet.</p> : null}
      {categories.map((category) => {
        const specific = scopes[category.id] === "fields";
        return (
          <fieldset key={category.id} className="rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{category.name}</legend>
            <div className={specific ? "hidden" : ""}>
              <LevelChoices name={`cat:${category.id}:level`} level={category.grantLevel} />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`cat:${category.id}:scope`}
                  value="category"
                  checked={!specific}
                  onChange={() => setScopes((current) => ({ ...current, [category.id]: "category" }))}
                />
                Entire dimension
                <HelpTip text="One level applies to every attribute in the dimension, including attributes added later." />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`cat:${category.id}:scope`}
                  value="fields"
                  checked={specific}
                  onChange={() => setScopes((current) => ({ ...current, [category.id]: "fields" }))}
                />
                Specific attributes
                <HelpTip text="Set none, view, or edit on each attribute. Missing attributes stay at none, and the department grant does not fill them in." />
              </label>
            </div>
            <div className={specific ? "mt-3 space-y-2" : "hidden"}>
              {category.fields.map((field) => (
                <div key={field.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm">
                  <span className={field.isActive ? "" : "text-muted"}>
                    {field.friendlyName}
                    {field.isActive ? "" : " (hidden)"}
                  </span>
                  <LevelChoices name={`field:${field.id}:level`} level={field.level} />
                </div>
              ))}
            </div>
          </fieldset>
        );
      })}
      <button className="btn" type="submit">
        Save access
      </button>
    </form>
  );
}

function LevelChoices({ name, level }: { name: string; level: GroupAccessLevel }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-sm">
      {(["NONE", "VIEW", "EDIT"] as const).map((choice) => (
        <label key={choice} className="flex items-center gap-2">
          <input type="radio" name={name} value={choice} defaultChecked={level === choice} />
          {choice === "NONE" ? "None" : choice === "VIEW" ? "View" : "Edit"}
        </label>
      ))}
    </div>
  );
}
