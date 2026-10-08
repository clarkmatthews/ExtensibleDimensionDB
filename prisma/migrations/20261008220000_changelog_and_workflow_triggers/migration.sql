CREATE TYPE "WorkflowKind" AS ENUM ('NOTIFY', 'TASK');
CREATE TYPE "StepFieldRule" AS ENUM ('MUST_HAVE_VALUE', 'MUST_CHANGE');

ALTER TABLE "WorkflowProcess" ADD COLUMN "kind" "WorkflowKind" NOT NULL DEFAULT 'TASK';
ALTER TABLE "WorkflowProcess" ADD COLUMN "onCreate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkflowProcess" ADD COLUMN "onChange" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkflowProcess" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;

UPDATE "WorkflowProcess" SET "onCreate" = true WHERE "isDefault" = true;

ALTER TABLE "WorkflowStepField" ADD COLUMN "rule" "StepFieldRule" NOT NULL DEFAULT 'MUST_HAVE_VALUE';

CREATE TABLE "FieldChange" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL DEFAULT '',
    "newValue" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FieldChange_locationId_createdAt_idx" ON "FieldChange"("locationId", "createdAt");
CREATE INDEX "FieldChange_createdAt_idx" ON "FieldChange"("createdAt");
CREATE INDEX "FieldChange_userId_idx" ON "FieldChange"("userId");
CREATE INDEX "FieldChange_fieldId_idx" ON "FieldChange"("fieldId");

ALTER TABLE "FieldChange" ADD CONSTRAINT "FieldChange_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FieldChange" ADD CONSTRAINT "FieldChange_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FieldChange" ADD CONSTRAINT "FieldChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Task" ADD COLUMN "fieldChangeId" TEXT;
CREATE INDEX "Task_fieldChangeId_idx" ON "Task"("fieldChangeId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_fieldChangeId_fkey" FOREIGN KEY ("fieldChangeId") REFERENCES "FieldChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD COLUMN "fieldChangeId" TEXT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_fieldChangeId_fkey" FOREIGN KEY ("fieldChangeId") REFERENCES "FieldChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WorkflowProcessCategory" (
    "processId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "WorkflowProcessCategory_pkey" PRIMARY KEY ("processId","categoryId")
);

ALTER TABLE "WorkflowProcessCategory" ADD CONSTRAINT "WorkflowProcessCategory_processId_fkey" FOREIGN KEY ("processId") REFERENCES "WorkflowProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowProcessCategory" ADD CONSTRAINT "WorkflowProcessCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkflowTriggerField" (
    "processId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "matchValue" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "WorkflowTriggerField_pkey" PRIMARY KEY ("processId","fieldId")
);

ALTER TABLE "WorkflowTriggerField" ADD CONSTRAINT "WorkflowTriggerField_processId_fkey" FOREIGN KEY ("processId") REFERENCES "WorkflowProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowTriggerField" ADD CONSTRAINT "WorkflowTriggerField_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkflowRecipient" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "groupId" TEXT,
    "userId" TEXT,

    CONSTRAINT "WorkflowRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowRecipient_processId_idx" ON "WorkflowRecipient"("processId");

ALTER TABLE "WorkflowRecipient" ADD CONSTRAINT "WorkflowRecipient_processId_fkey" FOREIGN KEY ("processId") REFERENCES "WorkflowProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRecipient" ADD CONSTRAINT "WorkflowRecipient_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRecipient" ADD CONSTRAINT "WorkflowRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
