CREATE TYPE "AppModule" AS ENUM ('INBOX', 'STORES', 'TASK_REPORT', 'DEFINITION', 'LISTS', 'PERMISSIONS', 'USERS', 'ACCESS', 'WORKFLOWS', 'NOTICES');

CREATE TABLE "ModulePermission" (
    "id" TEXT NOT NULL,
    "module" "AppModule" NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "grantLevel" "GrantLevel" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "ModulePermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModulePermission_module_subjectType_subjectId_key" ON "ModulePermission"("module", "subjectType", "subjectId");
CREATE INDEX "ModulePermission_subjectType_subjectId_idx" ON "ModulePermission"("subjectType", "subjectId");

INSERT INTO "ModulePermission" ("id", "module", "subjectType", "subjectId", "grantLevel")
SELECT gen_random_uuid()::text, day_to_day.module, 'USER', account.id, 'EDIT'
FROM "User" account
CROSS JOIN (
    SELECT unnest(ARRAY['INBOX', 'STORES', 'TASK_REPORT', 'NOTICES']::"AppModule"[]) AS module
) AS day_to_day
WHERE account."isAdmin" = false;

INSERT INTO "ModulePermission" ("id", "module", "subjectType", "subjectId", "grantLevel")
SELECT gen_random_uuid()::text, structure.module, 'USER', account.id, 'EDIT'
FROM "User" account
CROSS JOIN (
    SELECT unnest(ARRAY['DEFINITION', 'PERMISSIONS', 'USERS', 'ACCESS', 'WORKFLOWS']::"AppModule"[]) AS module
) AS structure
WHERE account."isAdmin" = false AND account."canDefineWorkflows" = true;
