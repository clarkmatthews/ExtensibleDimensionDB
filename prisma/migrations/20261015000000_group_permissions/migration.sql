-- Groups hold permissions; a person's own settings only override them, one item at a time.
-- Everyone keeps the access they had. The one deliberate change: the Permissions screen merges into
-- Groups (ACCESS), so whoever could open or change either now has the higher of the two on Groups.

-- 1. On a person's own row an empty right, or an empty level, now means "from groups".
ALTER TABLE "CategoryPermission"
  ALTER COLUMN "canAddFields" DROP NOT NULL, ALTER COLUMN "canAddFields" DROP DEFAULT,
  ALTER COLUMN "canRemoveFields" DROP NOT NULL, ALTER COLUMN "canRemoveFields" DROP DEFAULT,
  ALTER COLUMN "canEditFields" DROP NOT NULL, ALTER COLUMN "canEditFields" DROP DEFAULT,
  ALTER COLUMN "canEditCategory" DROP NOT NULL, ALTER COLUMN "canEditCategory" DROP DEFAULT,
  ALTER COLUMN "canAssignPermissions" DROP NOT NULL, ALTER COLUMN "canAssignPermissions" DROP DEFAULT,
  ALTER COLUMN "grantLevel" DROP NOT NULL, ALTER COLUMN "grantLevel" DROP DEFAULT;

-- What each person's groups give for each dimension, before anything changes.
CREATE TEMP TABLE group_grants AS
SELECT ug."userId", cp."categoryId",
  bool_or(cp."canAddFields") AS add_fields,
  bool_or(cp."canRemoveFields") AS remove_fields,
  bool_or(cp."canEditFields") AS edit_fields,
  bool_or(cp."canEditCategory") AS edit_category,
  bool_or(cp."canAssignPermissions") AS assign,
  bool_or(cp."canViewData" OR cp."grantLevel" IN ('VIEW', 'EDIT')) AS view_data
FROM "UserGroup" ug
JOIN "CategoryPermission" cp ON cp."subjectType" = 'GROUP' AND cp."subjectId" = ug."groupId"
GROUP BY ug."userId", cp."categoryId";

-- How each person's own dimension grant behaved before.
CREATE TEMP TABLE person_data AS
SELECT cp.id, cp."categoryId", cp."subjectId" AS "userId",
  (cp."grantLevel" IN ('VIEW', 'EDIT') AND NOT cp."applyToFields") AS whole,
  (cp."canViewData" OR cp."grantLevel" IN ('VIEW', 'EDIT')) AS old_view,
  cp."applyToFields" AS old_specific,
  EXISTS (
    SELECT 1 FROM "FieldPermission" fp JOIN "FieldDefinition" f ON f.id = fp."fieldId"
    WHERE fp."subjectType" = 'USER' AND fp."subjectId" = cp."subjectId" AND f."categoryId" = cp."categoryId"
  ) AS has_fields,
  COALESCE((SELECT g.view_data FROM group_grants g WHERE g."userId" = cp."subjectId" AND g."categoryId" = cp."categoryId"), false) AS groups_view
FROM "CategoryPermission" cp
WHERE cp."subjectType" = 'USER';

-- 2. Admin rights. A person's row used to decide every right for the dimension, so an unticked
-- right meant No. Keep No only where their groups say Yes; otherwise it now follows the groups.
UPDATE "CategoryPermission" cp SET
  "canAddFields" = CASE WHEN cp."canAddFields" OR COALESCE(g.add_fields, false) THEN cp."canAddFields" END,
  "canRemoveFields" = CASE WHEN cp."canRemoveFields" OR COALESCE(g.remove_fields, false) THEN cp."canRemoveFields" END,
  "canEditFields" = CASE WHEN cp."canEditFields" OR COALESCE(g.edit_fields, false) THEN cp."canEditFields" END,
  "canEditCategory" = CASE WHEN cp."canEditCategory" OR COALESCE(g.edit_category, false) THEN cp."canEditCategory" END,
  "canAssignPermissions" = CASE WHEN cp."canAssignPermissions" OR COALESCE(g.assign, false) THEN cp."canAssignPermissions" END
FROM "CategoryPermission" src
LEFT JOIN group_grants g ON g."userId" = src."subjectId" AND g."categoryId" = src."categoryId"
WHERE cp.id = src.id AND cp."subjectType" = 'USER';

-- 3. Data access.
-- An attribute grant with no dimension grant of the person's own: it showed only when their groups
-- let them see the dimension. Keep it as a specific-attribute override there; drop it elsewhere.
INSERT INTO "CategoryPermission" (id, "categoryId", "subjectType", "subjectId", "canViewData", "applyToFields")
SELECT DISTINCT 'own_' || fp."subjectId" || '_' || f."categoryId", f."categoryId", 'USER'::"SubjectType", fp."subjectId", true, true
FROM "FieldPermission" fp
JOIN "FieldDefinition" f ON f.id = fp."fieldId"
JOIN group_grants g ON g."userId" = fp."subjectId" AND g."categoryId" = f."categoryId" AND g.view_data
WHERE fp."subjectType" = 'USER'
  AND NOT EXISTS (SELECT 1 FROM person_data p WHERE p."userId" = fp."subjectId" AND p."categoryId" = f."categoryId");

DELETE FROM "FieldPermission" fp USING "FieldDefinition" f
WHERE f.id = fp."fieldId" AND fp."subjectType" = 'USER'
  AND NOT EXISTS (
    SELECT 1 FROM "CategoryPermission" cp
    WHERE cp."subjectType" = 'USER' AND cp."subjectId" = fp."subjectId" AND cp."categoryId" = f."categoryId"
  );

-- Entire dimension at View or Edit: unchanged. Its attribute rows never applied.
-- Data hidden (View data unticked): None where groups would show it, otherwise from groups.
UPDATE "CategoryPermission" cp SET
  "grantLevel" = CASE WHEN p.groups_view THEN 'NONE'::"GrantLevel" END,
  "applyToFields" = false
FROM person_data p WHERE p.id = cp.id AND NOT p.whole AND NOT p.old_view;

-- Data shown with the person's own attribute grants: specific attributes. Attributes without a grant
-- of their own now follow the groups, except where they used to be shut (an old specific grant).
UPDATE "CategoryPermission" cp SET "grantLevel" = NULL, "applyToFields" = (p.has_fields OR p.old_specific)
FROM person_data p WHERE p.id = cp.id AND NOT p.whole AND p.old_view;

INSERT INTO "FieldPermission" (id, "fieldId", "subjectType", "subjectId", "canView", "canUpdate")
SELECT 'none_' || p."userId" || '_' || f.id, f.id, 'USER'::"SubjectType", p."userId", false, false
FROM person_data p
JOIN "FieldDefinition" f ON f."categoryId" = p."categoryId"
WHERE NOT p.whole AND p.old_view AND p.old_specific
  AND NOT EXISTS (SELECT 1 FROM "FieldPermission" fp WHERE fp."fieldId" = f.id AND fp."subjectType" = 'USER' AND fp."subjectId" = p."userId");

-- Attribute rows apply only to specific-attribute grants.
DELETE FROM "FieldPermission" fp USING "FieldDefinition" f, "CategoryPermission" cp
WHERE f.id = fp."fieldId" AND fp."subjectType" = 'USER'
  AND cp."subjectType" = 'USER' AND cp."subjectId" = fp."subjectId" AND cp."categoryId" = f."categoryId"
  AND NOT cp."applyToFields";

UPDATE "CategoryPermission" SET "canViewData" = ("applyToFields" OR COALESCE("grantLevel" IN ('VIEW', 'EDIT'), false))
WHERE "subjectType" = 'USER';

-- A person's row that no longer overrides anything.
DELETE FROM "CategoryPermission"
WHERE "subjectType" = 'USER' AND "grantLevel" IS NULL AND NOT "applyToFields"
  AND "canAddFields" IS NULL AND "canRemoveFields" IS NULL AND "canEditFields" IS NULL
  AND "canEditCategory" IS NULL AND "canAssignPermissions" IS NULL;

-- Group rows always state every right.
UPDATE "CategoryPermission" SET
  "canAddFields" = COALESCE("canAddFields", false),
  "canRemoveFields" = COALESCE("canRemoveFields", false),
  "canEditFields" = COALESCE("canEditFields", false),
  "canEditCategory" = COALESCE("canEditCategory", false),
  "canAssignPermissions" = COALESCE("canAssignPermissions", false),
  "grantLevel" = COALESCE("grantLevel", 'NONE')
WHERE "subjectType" = 'GROUP';

-- 4. The Permissions screen merges into Groups (ACCESS): each group and person gets the higher of the two.
CREATE TEMP TABLE screen_before AS
SELECT * FROM "ModulePermission" WHERE module::text IN ('PERMISSIONS', 'ACCESS');

INSERT INTO "ModulePermission" (id, module, "subjectType", "subjectId", "grantLevel")
SELECT 'groups_' || s."subjectId", 'ACCESS', 'GROUP', s."subjectId", s."grantLevel"
FROM screen_before s WHERE s.module::text = 'PERMISSIONS' AND s."subjectType" = 'GROUP'
ON CONFLICT (module, "subjectType", "subjectId")
DO UPDATE SET "grantLevel" = GREATEST("ModulePermission"."grantLevel", EXCLUDED."grantLevel");

CREATE TEMP TABLE person_screen AS
WITH people AS (
  SELECT DISTINCT "subjectId" AS uid FROM screen_before WHERE "subjectType" = 'USER'
), from_groups AS (
  SELECT ug."userId" AS uid,
    max(CASE WHEN s.module::text = 'ACCESS' THEN s."grantLevel" END) AS ga,
    max(CASE WHEN s.module::text = 'PERMISSIONS' THEN s."grantLevel" END) AS gp
  FROM "UserGroup" ug
  JOIN screen_before s ON s."subjectType" = 'GROUP' AND s."subjectId" = ug."groupId"
  GROUP BY ug."userId"
)
SELECT p.uid,
  GREATEST(COALESCE(ua."grantLevel", g.ga, 'NONE'), COALESCE(up."grantLevel", g.gp, 'NONE')) AS desired,
  COALESCE(GREATEST(g.ga, g.gp), 'NONE') AS inherited
FROM people p
LEFT JOIN from_groups g ON g.uid = p.uid
LEFT JOIN screen_before ua ON ua."subjectType" = 'USER' AND ua."subjectId" = p.uid AND ua.module::text = 'ACCESS'
LEFT JOIN screen_before up ON up."subjectType" = 'USER' AND up."subjectId" = p.uid AND up.module::text = 'PERMISSIONS';

DELETE FROM "ModulePermission" m USING person_screen p
WHERE m."subjectType" = 'USER' AND m."subjectId" = p.uid AND m.module::text = 'ACCESS' AND p.desired = p.inherited;

INSERT INTO "ModulePermission" (id, module, "subjectType", "subjectId", "grantLevel")
SELECT 'groups_' || p.uid, 'ACCESS', 'USER', p.uid, p.desired FROM person_screen p WHERE p.desired <> p.inherited
ON CONFLICT (module, "subjectType", "subjectId") DO UPDATE SET "grantLevel" = EXCLUDED."grantLevel";

DELETE FROM "ModulePermission" WHERE module::text = 'PERMISSIONS';

DROP TABLE group_grants;
DROP TABLE person_data;
DROP TABLE screen_before;
DROP TABLE person_screen;

ALTER TYPE "AppModule" RENAME TO "AppModule_old";
CREATE TYPE "AppModule" AS ENUM (
  'INBOX', 'STORES', 'TASK_REPORT', 'DEFINITION', 'LISTS', 'USERS', 'ACCESS', 'WORKFLOWS', 'NOTICES',
  'API_CONFIG', 'EMAIL_CONFIG', 'SITE_CONFIG', 'AUDIT', 'WEBHOOKS', 'IMPORT', 'AI_ACCESS', 'PROPOSALS', 'SSO'
);
ALTER TABLE "ModulePermission" ALTER COLUMN "module" TYPE "AppModule" USING ("module"::text::"AppModule");
DROP TYPE "AppModule_old";

