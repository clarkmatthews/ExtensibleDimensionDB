ALTER TABLE "FieldDefinition" ADD COLUMN "parentFieldId" TEXT;

ALTER TABLE "FieldOption" ADD COLUMN "parentValues" TEXT NOT NULL DEFAULT '';

ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_parentFieldId_fkey" FOREIGN KEY ("parentFieldId") REFERENCES "FieldDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "FieldDefinition" AS city
SET "parentFieldId" = state.id
FROM "FieldDefinition" AS state
WHERE city.key = 'city'
  AND city."choiceSource" = 'US_CITY'
  AND state.key = 'state'
  AND state."choiceSource" = 'US_STATE'
  AND city."parentFieldId" IS NULL;
