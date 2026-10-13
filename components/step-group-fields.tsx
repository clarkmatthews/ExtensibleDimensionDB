"use client";

import { useState } from "react";
import { HelpTip } from "@/components/help-tip";

type Person = { id: string; name: string; groupIds: string[] };

/**
 * The Group and Assignee pair on a workflow step. The assignee list follows the chosen group, so
 * only members can be picked; changing the group clears an assignee who is not a member.
 */
export function StepGroupFields({
  groups,
  people,
  defaultGroupId,
  defaultAssigneeId,
  compact = false,
}: {
  groups: { id: string; name: string }[];
  people: Person[];
  defaultGroupId: string;
  defaultAssigneeId: string;
  compact?: boolean;
}) {
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);
  const members = people.filter((person) => person.groupIds.includes(groupId));
  return (
    <>
      <label>
        <span className="label">
          Group
          {compact ? null : <HelpTip text="Action: the group that receives the action. Notify: the group whose members are notified; leave it empty to notify only the person." />}
        </span>
        <select
          className="field"
          name="groupId"
          value={groupId}
          onChange={(event) => {
            const next = event.target.value;
            setGroupId(next);
            if (!people.some((person) => person.id === assigneeId && person.groupIds.includes(next))) setAssigneeId("");
          }}
        >
          <option value="">No group</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </label>
      <label className="action-only">
        <span className="label">
          Assignee
          {compact ? null : <HelpTip text="Optional. New actions for this step go to this person. The list shows members of the chosen group." />}
        </span>
        <select className="field" name="assigneeUserId" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} disabled={!groupId}>
          <option value="">{groupId ? "Anyone in the group" : "Choose a group first"}</option>
          {members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </label>
    </>
  );
}
