-- Record types. Existing dimensions and records become the first type, "Location".
CREATE TABLE "RecordType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecordType_name_key" ON "RecordType"("name");
INSERT INTO "RecordType" ("id", "name", "description", "sortOrder")
VALUES ('location', 'Location', 'The records this database started with.', 1);

ALTER TABLE "Category" ADD COLUMN "recordTypeId" TEXT;
UPDATE "Category" SET "recordTypeId" = 'location';
ALTER TABLE "Category" ALTER COLUMN "recordTypeId" SET NOT NULL;
ALTER TABLE "Category" ADD CONSTRAINT "Category_recordTypeId_fkey" FOREIGN KEY ("recordTypeId") REFERENCES "RecordType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Category_recordTypeId_idx" ON "Category"("recordTypeId");

ALTER TABLE "Location" ADD COLUMN "recordTypeId" TEXT;
UPDATE "Location" SET "recordTypeId" = 'location';
ALTER TABLE "Location" ALTER COLUMN "recordTypeId" SET NOT NULL;
ALTER TABLE "Location" ADD CONSTRAINT "Location_recordTypeId_fkey" FOREIGN KEY ("recordTypeId") REFERENCES "RecordType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Location_recordTypeId_isActive_idx" ON "Location"("recordTypeId", "isActive");

-- Links between records.
ALTER TYPE "DataType" ADD VALUE 'RECORD_LINK';
ALTER TABLE "FieldDefinition" ADD COLUMN "linkTypeId" TEXT;
ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_linkTypeId_fkey" FOREIGN KEY ("linkTypeId") REFERENCES "RecordType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportJob" ADD COLUMN "recordTypeId" TEXT NOT NULL DEFAULT '';
