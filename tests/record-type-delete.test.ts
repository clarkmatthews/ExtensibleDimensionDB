import { describe, expect, it } from "vitest";
import { deleteRecordTypeGraph, previewRecordType } from "@/lib/cascade-delete";

type Field = { id: string; friendlyName: string; parentFieldId: string | null; linkTypeId: string | null; categoryId: string };
type Row = { id: string; recordTypeId?: string; locationId?: string; storeProcessId?: string; taskId?: string | null; fieldId?: string };

function idsIn(where: { id?: { in?: string[] }; in?: string[] } | undefined) {
  return where?.id?.in ?? where?.in ?? null;
}

function fakeDb() {
  const types = [
    { id: "vendor", name: "Vendor" },
    { id: "location", name: "Location" },
    { id: "empty", name: "Empty" },
  ];
  const categories: Row[] = [
    { id: "contact", recordTypeId: "vendor" },
    { id: "general", recordTypeId: "location" },
  ];
  const fields: Field[] = [
    { id: "name", friendlyName: "Name", parentFieldId: null, linkTypeId: null, categoryId: "contact" },
    { id: "city", friendlyName: "City", parentFieldId: "name", linkTypeId: null, categoryId: "contact" },
    { id: "region", friendlyName: "Region", parentFieldId: "city", linkTypeId: null, categoryId: "general" },
    { id: "supplier", friendlyName: "Supplier", parentFieldId: null, linkTypeId: "vendor", categoryId: "general" },
    { id: "notes", friendlyName: "Notes", parentFieldId: null, linkTypeId: null, categoryId: "general" },
  ];
  const locations: Row[] = [{ id: "loc1", recordTypeId: "vendor" }];
  const processes: Row[] = [{ id: "sp1", locationId: "loc1" }];
  const tasks: Row[] = [{ id: "t1", locationId: "loc1", storeProcessId: "sp1" }];
  const notifications: Row[] = [{ id: "n1", taskId: "t1" }];
  const steps: Row[] = [{ id: "ws1", fieldId: "name" }];
  const proposals: Row[] = [{ id: "p1", recordTypeId: "vendor" }];
  const imports: Row[] = [{ id: "j1", recordTypeId: "vendor" }];
  const values: Row[] = [{ id: "v1", fieldId: "name" }];

  const db = {
    recordType: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const type = types.find((item) => item.id === where.id);
        if (!type) return null;
        return {
          ...type,
          categories: categories
            .filter((category) => category.recordTypeId === type.id)
            .map((category) => ({
              id: category.id,
              fields: fields.filter((field) => field.categoryId === category.id).map((field) => ({ id: field.id })),
            })),
        };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = types.findIndex((item) => item.id === where.id);
        if (index < 0) throw new Error("missing type");
        types.splice(index, 1);
      },
    },
    fieldDefinition: {
      findMany: async ({ where }: { where?: { linkTypeId?: string } } = {}) => {
        const rows = where?.linkTypeId ? fields.filter((field) => field.linkTypeId === where.linkTypeId) : fields;
        return rows.map((field) => ({ ...field }));
      },
      updateMany: async ({ where, data }: { where: { parentFieldId?: { in: string[] }; linkTypeId?: string }; data: { parentFieldId?: null; linkTypeId?: null } }) => {
        for (const field of fields) {
          if (where.parentFieldId?.in.includes(field.parentFieldId ?? "")) field.parentFieldId = data.parentFieldId ?? null;
          if (where.linkTypeId && field.linkTypeId === where.linkTypeId) field.linkTypeId = data.linkTypeId ?? null;
        }
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const drop = new Set(where.id.in);
        for (let index = fields.length - 1; index >= 0; index -= 1) {
          if (drop.has(fields[index].id)) fields.splice(index, 1);
        }
      },
    },
    location: {
      count: async ({ where }: { where: { recordTypeId: string } }) => locations.filter((row) => row.recordTypeId === where.recordTypeId).length,
      findMany: async ({ where }: { where: { recordTypeId: string } }) => locations.filter((row) => row.recordTypeId === where.recordTypeId).map((row) => ({ id: row.id })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const drop = new Set(where.id.in);
        for (let index = locations.length - 1; index >= 0; index -= 1) if (drop.has(locations[index].id)) locations.splice(index, 1);
      },
    },
    storeProcess: {
      findMany: async ({ where }: { where: { locationId: { in: string[] } } }) =>
        processes.filter((row) => where.locationId.in.includes(row.locationId ?? "")).map((row) => ({ id: row.id })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const drop = new Set(where.id.in);
        for (let index = processes.length - 1; index >= 0; index -= 1) if (drop.has(processes[index].id)) processes.splice(index, 1);
      },
    },
    task: {
      findMany: async ({ where }: { where: { OR: { locationId?: { in: string[] }; storeProcessId?: { in: string[] } }[] } }) =>
        tasks
          .filter((task) => where.OR.some((clause) => clause.locationId?.in.includes(task.locationId ?? "") || clause.storeProcessId?.in.includes(task.storeProcessId ?? "")))
          .map((task) => ({ id: task.id })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const drop = new Set(where.id.in);
        for (let index = tasks.length - 1; index >= 0; index -= 1) if (drop.has(tasks[index].id)) tasks.splice(index, 1);
      },
    },
    notification: {
      updateMany: async ({ where, data }: { where: { taskId: { in: string[] } }; data: { taskId: null } }) => {
        for (const note of notifications) if (where.taskId.in.includes(note.taskId ?? "")) note.taskId = data.taskId;
      },
    },
    workflowStepField: {
      count: async ({ where }: { where: { fieldId: { in: string[] } } }) => steps.filter((step) => where.fieldId.in.includes(step.fieldId ?? "")).length,
      deleteMany: async ({ where }: { where: { fieldId: { in: string[] } } }) => {
        for (let index = steps.length - 1; index >= 0; index -= 1) if (where.fieldId.in.includes(steps[index].fieldId ?? "")) steps.splice(index, 1);
      },
    },
    fieldValue: {
      deleteMany: async ({ where }: { where: { fieldId: { in: string[] } } }) => {
        for (let index = values.length - 1; index >= 0; index -= 1) if (where.fieldId.in.includes(values[index].fieldId ?? "")) values.splice(index, 1);
      },
    },
    category: {
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const drop = new Set(idsIn(where) ?? []);
        for (let index = categories.length - 1; index >= 0; index -= 1) if (drop.has(categories[index].id)) categories.splice(index, 1);
      },
    },
    changeProposal: {
      deleteMany: async ({ where }: { where: { recordTypeId: string } }) => {
        for (let index = proposals.length - 1; index >= 0; index -= 1) if (proposals[index].recordTypeId === where.recordTypeId) proposals.splice(index, 1);
      },
    },
    importJob: {
      deleteMany: async ({ where }: { where: { recordTypeId: string } }) => {
        for (let index = imports.length - 1; index >= 0; index -= 1) if (imports[index].recordTypeId === where.recordTypeId) imports.splice(index, 1);
      },
    },
    snapshot: () => ({
      types: types.map((type) => type.id),
      categories: categories.map((category) => category.id),
      fields: fields.map((field) => field.id),
      locations: locations.map((location) => location.id),
      processes: processes.map((process) => process.id),
      tasks: tasks.map((task) => task.id),
      notifications: notifications.map((note) => note.taskId),
      steps: steps.map((step) => step.id),
      proposals: proposals.map((proposal) => proposal.id),
      imports: imports.map((job) => job.id),
      values: values.map((value) => value.id),
    }),
  };
  return db;
}

describe("record type delete", () => {
  it("warns that attribute definitions are removed, including ones that follow them", async () => {
    const db = fakeDb();
    const preview = await previewRecordType(db as never, "vendor");
    expect(preview.error).toBe("");
    expect(preview.title).toBe("Delete Vendor?");
    expect(preview.message).toContain("also removes its attribute definitions, including attributes that follow them");
    expect(preview.message).toContain("Name, City, Supplier, and Region");
    expect(preview.message).toContain("Its 1 dimension and 1 record will be removed.");
    expect(preview.message).toContain("Links on 1 workflow step will be removed.");
  });

  it("says when a record type has no attribute definitions", async () => {
    const db = fakeDb();
    const preview = await previewRecordType(db as never, "empty");
    expect(preview.message).toBe("Deleting Empty removes the record type. It has no attribute definitions.");
  });

  it("removes the type, its attributes, followers, and records", async () => {
    const db = fakeDb();
    expect(await deleteRecordTypeGraph(db as never, "vendor")).toBe(true);
    expect(db.snapshot()).toEqual({
      types: ["location", "empty"],
      categories: ["general"],
      fields: ["notes"],
      locations: [],
      processes: [],
      tasks: [],
      notifications: [null],
      steps: [],
      proposals: [],
      imports: [],
      values: [],
    });
    expect(await deleteRecordTypeGraph(db as never, "missing")).toBe(false);
  });
});
