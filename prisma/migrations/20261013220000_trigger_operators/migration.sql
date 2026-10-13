CREATE TYPE "TriggerOperator" AS ENUM ('ANY', 'BECOMES', 'CHANGES_FROM', 'CONTAINS', 'BECOMES_EMPTY', 'GETS_VALUE');
ALTER TABLE "WorkflowTriggerField" ADD COLUMN "operator" "TriggerOperator" NOT NULL DEFAULT 'ANY';
-- A match value used to mean "the new value is exactly this".
UPDATE "WorkflowTriggerField" SET "operator" = 'BECOMES' WHERE btrim("matchValue") <> '';
