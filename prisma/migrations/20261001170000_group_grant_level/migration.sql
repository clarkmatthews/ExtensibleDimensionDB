CREATE TYPE "GrantLevel" AS ENUM ('NONE', 'VIEW', 'EDIT');

ALTER TABLE "CategoryPermission" ADD COLUMN "grantLevel" "GrantLevel" NOT NULL DEFAULT 'NONE';

ALTER TABLE "CategoryPermission" ADD COLUMN "applyToFields" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CategoryPermission" AS category_grant
SET "applyToFields" = true
WHERE category_grant."subjectType" = 'GROUP'
  AND EXISTS (
    SELECT 1
    FROM "FieldPermission" AS field_grant
    JOIN "FieldDefinition" AS field ON field."id" = field_grant."fieldId"
    WHERE field_grant."subjectType" = 'GROUP'
      AND field_grant."subjectId" = category_grant."subjectId"
      AND field."categoryId" = category_grant."categoryId"
  );

UPDATE "CategoryPermission"
SET "grantLevel" = 'VIEW'
WHERE "subjectType" = 'GROUP'
  AND "canViewData" = true
  AND "applyToFields" = false;
