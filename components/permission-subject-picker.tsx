"use client";

import { useRouter } from "next/navigation";

type Option = { id: string; label: string };

export function PermissionSubjectPicker({
  subjectType,
  subjectId,
  groups,
  users,
}: {
  subjectType: string;
  subjectId: string;
  groups: Option[];
  users: Option[];
}) {
  const router = useRouter();
  const options = subjectType === "GROUP" ? groups : users;

  function open(type: string, id: string) {
    const list = type === "GROUP" ? groups : users;
    const nextId = list.some((item) => item.id === id) ? id : (list[0]?.id ?? "");
    const params = new URLSearchParams({ subjectType: type });
    if (nextId) params.set("subjectId", nextId);
    router.push(`/admin/permissions?${params.toString()}`);
  }

  return (
    <form className="panel flex flex-wrap gap-3 p-4" onSubmit={(event) => event.preventDefault()}>
      <label>
        <span className="label">Who</span>
        <select className="field w-auto" value={subjectType} onChange={(event) => open(event.target.value, "")}>
          <option value="USER">User</option>
          <option value="GROUP">Group</option>
        </select>
      </label>
      <label>
        <span className="label">Name</span>
        <select
          className="field w-auto"
          value={subjectId}
          disabled={options.length === 0}
          onChange={(event) => open(subjectType, event.target.value)}
        >
          {options.length === 0 ? <option value="">None yet</option> : null}
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
