-- File attributes: uploads such as PDF and Word documents, stored in the database.
ALTER TYPE "DataType" ADD VALUE 'FILE';

ALTER TABLE "FieldDefinition" ADD COLUMN "fileTypes" TEXT NOT NULL DEFAULT '';

CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StoredFile_locationId_idx" ON "StoredFile"("locationId");
CREATE INDEX "StoredFile_fieldId_idx" ON "StoredFile"("fieldId");
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
