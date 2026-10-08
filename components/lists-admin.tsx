"use client";

import { useMemo, useState } from "react";
import { HelpTip } from "@/components/help-tip";
import { CorrelatedListEditor } from "@/components/correlated-list-editor";
import { ListConfigDialog, type ListItem, type ListPeer } from "@/components/list-config-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { createList, deleteList, previewListDelete, saveListContents, setListActive } from "@/lib/list-actions";

export type ManagedList = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  choiceSource: "MANUAL" | "US_STATE" | "US_CITY";
  parentListId: string;
  fields: string[];
  activeCount: number;
  items: ListItem[];
};

export function ListsAdmin({
  lists,
  initialOpen,
  error,
  canEdit,
}: {
  lists: ManagedList[];
  initialOpen: string;
  error: string;
  canEdit: boolean;
}) {
  const [openId, setOpenId] = useState(initialOpen);
  const open = lists.find((list) => list.id === openId);
  const catalog = useMemo(
    () =>
      lists.map((list) => ({
        id: list.id,
        name: list.name,
        parentListId: list.parentListId,
        items: list.items
          .filter((item) => item.isActive !== false)
          .map((item) => ({ label: item.label, value: item.value || item.label })),
      })),
    [lists],
  );
  const peers: ListPeer[] = lists.map((list) => ({
    id: list.id,
    friendlyName: list.isActive ? list.name : `${list.name} (inactive)`,
    choiceSource: list.choiceSource,
    parentFieldId: list.parentListId,
    options: list.items
      .filter((item) => item.isActive !== false)
      .map((item) => ({ label: item.label, value: item.value || item.label })),
  }));

  async function apply(next: { items: ListItem[]; parentFieldId: string; name: string; description: string }) {
    if (!open) return;
    const formData = new FormData();
    formData.set("id", open.id);
    formData.set("name", next.name);
    formData.set("description", next.description);
    formData.set("parentListId", next.parentFieldId);
    formData.set("items", JSON.stringify(next.items));
    const result = await saveListContents(formData);
    if (result.error) return result.error;
    setOpenId("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          Lists
          <HelpTip text="A list supplies the choices for a list or radio attribute. A list can follow another list, and each of its items can belong to a value from that list. Those lists can follow further lists, so the choices narrow one level at a time. Deactivate a list to hide it from new attributes. Delete removes the list, lists that follow it, attributes that use them, and the values stored on dimensions." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Create lists, edit their items, and deactivate a list without deleting it. Delete asks you to confirm, and when the list is in use it removes the correlated lists, attributes, and dimension values with it.
        </p>
      </div>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {canEdit ? (
      <form action={createList} className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
        <label>
          <span className="label">New list</span>
          <input className="field" name="name" required />
        </label>
        <label>
          <span className="label">Description</span>
          <input className="field" name="description" />
        </label>
        <label>
          <span className="label">Follows <HelpTip text="Items in this list belong to values from the list it follows. A list can follow a list that already follows another, and each level narrows the choices." /></span>
          <select className="field" name="parentListId" defaultValue="">
            <option value="">No other list</option>
            {lists.filter((list) => list.isActive).map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn self-end" type="submit">
          Create list
        </button>
      </form>
      ) : (
        <p className="text-sm text-muted">You can view these lists. Edit access is required to change them.</p>
      )}
      {lists.length === 0 ? <p className="text-sm text-muted">No lists yet.</p> : null}
      <div className="space-y-3">
        {lists.map((list) => {
          const parent = lists.find((item) => item.id === list.parentListId);
          const summary = parent
            ? `${list.activeCount} ${list.activeCount === 1 ? "item" : "items"} correlated to ${parent.name}.`
            : `${list.activeCount} ${list.activeCount === 1 ? "item" : "items"}.`;
          return (
            <section key={list.id} className="panel px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className={list.isActive ? "font-semibold" : "font-semibold text-muted line-through"}>{list.name}</h2>
                  <p className="text-sm text-muted">
                    {summary}
                    {parent ? ` Follows ${parent.name}.` : " Does not follow another list."}
                    {list.fields.length ? ` Used by ${list.fields.join(", ")}.` : " Not used by an attribute yet."}
                  </p>
                </div>
                {canEdit ? (
                <div className="flex gap-2">
                  <button className="btn-quiet" type="button" onClick={() => setOpenId(list.id)}>
                    Manage contents
                  </button>
                  <form action={setListActive}>
                    <input type="hidden" name="id" value={list.id} />
                    <input type="hidden" name="active" value={list.isActive ? "0" : "1"} />
                    <span className="inline-flex items-center">
                      <button className="btn-quiet" type="submit">{list.isActive ? "Deactivate" : "Activate"}</button>
                      <HelpTip text="Deactivate hides the list from new attributes. Attributes that already use it keep their choices." />
                    </span>
                  </form>
                  <ConfirmDelete id={list.id} preview={previewListDelete} commit={deleteList} onDone={() => setOpenId((current) => (current === list.id ? "" : current))} />
                </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      {open?.parentListId ? (
        <CorrelatedListEditor
          listId={open.id}
          listName={open.name}
          description={open.description}
          parentListId={open.parentListId}
          lists={catalog}
          onClose={() => setOpenId("")}
          onSaveDetails={async (next) => {
            const formData = new FormData();
            formData.set("id", open.id);
            formData.set("name", next.name);
            formData.set("description", next.description);
            formData.set("parentListId", next.parentListId);
            formData.set("items", "[]");
            const result = await saveListContents(formData);
            if (result.error) return result.error;
            setOpenId("");
          }}
        />
      ) : null}
      {open && !open.parentListId ? (
        <ListConfigDialog
          fieldId={open.id}
          fieldName={open.name}
          dataType="DROPDOWN"
          choiceSource={open.choiceSource}
          multiple
          numVisible="1"
          items={open.items}
          parentFieldId={open.parentListId}
          peers={peers}
          title="List contents"
          followsEmptyLabel="No other list"
          showPresentation={false}
          applyLabel="Save list"
          identity={{ name: open.name, description: open.description }}
          onClose={() => setOpenId("")}
          onApply={apply}
        />
      ) : null}
    </div>
  );
}
