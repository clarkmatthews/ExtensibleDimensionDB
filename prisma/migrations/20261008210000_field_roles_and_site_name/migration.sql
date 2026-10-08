ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'SITE_CONFIG';

ALTER TABLE "FieldDefinition" ADD COLUMN "isActiveFilter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FieldDefinition" ADD COLUMN "isCreatedDate" BOOLEAN NOT NULL DEFAULT false;

UPDATE "FieldDefinition"
SET "isActiveFilter" = true
WHERE "key" = 'is_active' AND "dataType" = 'CHECKBOX';

UPDATE "FieldDefinition"
SET "isCreatedDate" = true
WHERE "key" = 'created_at' AND "dataType" = 'DATE';

CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT 'Dimension database',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SiteSettings" ("id", "name", "updatedAt")
VALUES ('default', 'Dimension database', CURRENT_TIMESTAMP);
