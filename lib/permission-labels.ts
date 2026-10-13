import type { StructureRight } from "@/lib/permissions";

export type Level = "NONE" | "VIEW" | "EDIT";

export const LEVEL_LABEL: Record<Level, string> = { NONE: "None", VIEW: "View", EDIT: "Edit" };

/** A dimension's admin rights, with the form name each one is saved under. */
export const RIGHTS = [
  { key: "add", right: "canAddFields", label: "Add attributes", help: "Create new attributes in this dimension." },
  { key: "remove", right: "canRemoveFields", label: "Hide attributes", help: "Deactivate an attribute so it leaves the dimension editor. The stored values stay." },
  { key: "edit", right: "canEditFields", label: "Edit attributes", help: "Change an attribute's definition, such as its type, pattern, and default." },
  { key: "category", right: "canEditCategory", label: "Edit dimension", help: "Rename this dimension, change its description, and reorder it." },
  { key: "assign", right: "canAssignPermissions", label: "Assign permissions", help: "Set this dimension's access for groups and people." },
] as const satisfies readonly { key: string; right: StructureRight; label: string; help: string }[];

export type RightKey = (typeof RIGHTS)[number]["key"];

