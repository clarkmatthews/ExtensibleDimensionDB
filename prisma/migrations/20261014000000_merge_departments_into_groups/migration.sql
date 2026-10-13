-- Departments are merged into groups. Each department becomes a group whose members are everyone
-- in the groups that were linked to it, and its screen, dimension and attribute grants move to
-- that group unchanged. DepartmentMerge records the mapping for the access report.

CREATE TABLE "DepartmentMerge" (
    "departmentId" TEXT NOT NULL,
    "departmentName" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "linkedGroupIds" TEXT[],
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepartmentMerge_pkey" PRIMARY KEY ("departmentId")
);

-- 1. A group for each department. It keeps the department's name, with " (department)" added when
--    a group already has that name.
INSERT INTO "Group" ("id", "name", "description", "isActive", "createdAt")
SELECT
  'dept_' || d."id",
  CASE WHEN EXISTS (SELECT 1 FROM "Group" g WHERE lower(g."name") = lower(d."name"))
       THEN d."name" || ' (department)' ELSE d."name" END,
  d."description",
  d."isActive",
  d."createdAt"
FROM "Department" d;

INSERT INTO "DepartmentMerge" ("departmentId", "departmentName", "groupId", "linkedGroupIds")
SELECT d."id", d."name", 'dept_' || d."id",
       COALESCE(ARRAY(SELECT g."id" FROM "Group" g WHERE g."departmentId" = d."id" ORDER BY g."id"), ARRAY[]::TEXT[])
FROM "Department" d;

-- 2. Members: everyone who reached the department through a linked group.
INSERT INTO "UserGroup" ("userId", "groupId")
SELECT DISTINCT ug."userId", 'dept_' || g."departmentId"
FROM "UserGroup" ug
JOIN "Group" g ON g."id" = ug."groupId"
WHERE g."departmentId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Grants. A department's per-attribute grants are marked "specific attributes", which is how a
--    group stores them; what they allow is unchanged.
UPDATE "CategoryPermission" cp
SET "applyToFields" = true
WHERE cp."subjectType" = 'DEPARTMENT'
  AND cp."applyToFields" = false
  AND cp."grantLevel" = 'NONE'
  AND EXISTS (
    SELECT 1 FROM "FieldPermission" fp
    JOIN "FieldDefinition" f ON f."id" = fp."fieldId"
    WHERE fp."subjectType" = 'DEPARTMENT' AND fp."subjectId" = cp."subjectId" AND f."categoryId" = cp."categoryId"
  );

UPDATE "CategoryPermission" SET "subjectType" = 'GROUP', "subjectId" = 'dept_' || "subjectId" WHERE "subjectType" = 'DEPARTMENT';
UPDATE "FieldPermission"    SET "subjectType" = 'GROUP', "subjectId" = 'dept_' || "subjectId" WHERE "subjectType" = 'DEPARTMENT';
-- A group's screen access only stores View and Edit; None is the absence of a grant.
DELETE FROM "ModulePermission" WHERE "subjectType" = 'DEPARTMENT' AND "grantLevel" = 'NONE';
UPDATE "ModulePermission"   SET "subjectType" = 'GROUP', "subjectId" = 'dept_' || "subjectId" WHERE "subjectType" = 'DEPARTMENT';

-- 4. Remove departments.
ALTER TABLE "Group" DROP CONSTRAINT IF EXISTS "Group_departmentId_fkey";
ALTER TABLE "Group" DROP COLUMN "departmentId";
DROP TABLE "Department";

ALTER TYPE "SubjectType" RENAME TO "SubjectType_old";
CREATE TYPE "SubjectType" AS ENUM ('GROUP', 'USER');
ALTER TABLE "CategoryPermission" ALTER COLUMN "subjectType" TYPE "SubjectType" USING ("subjectType"::text::"SubjectType");
ALTER TABLE "FieldPermission"    ALTER COLUMN "subjectType" TYPE "SubjectType" USING ("subjectType"::text::"SubjectType");
ALTER TABLE "ModulePermission"   ALTER COLUMN "subjectType" TYPE "SubjectType" USING ("subjectType"::text::"SubjectType");
DROP TYPE "SubjectType_old";
