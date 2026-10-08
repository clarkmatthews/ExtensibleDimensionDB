CREATE TABLE "ChoiceList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "choiceSource" "ChoiceSource" NOT NULL DEFAULT 'MANUAL',
    "parentListId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChoiceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChoiceListItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "parentValues" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChoiceListItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FieldDefinition" ADD COLUMN "choiceListId" TEXT;

ALTER TABLE "ChoiceList" ADD CONSTRAINT "ChoiceList_parentListId_fkey" FOREIGN KEY ("parentListId") REFERENCES "ChoiceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChoiceListItem" ADD CONSTRAINT "ChoiceListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ChoiceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_choiceListId_fkey" FOREIGN KEY ("choiceListId") REFERENCES "ChoiceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ChoiceList" ("id", "name", "description", "choiceSource")
SELECT 'list_us_states', 'US States', 'The 50 states and Washington, D.C.', 'US_STATE'
WHERE NOT EXISTS (SELECT 1 FROM "ChoiceList" WHERE "choiceSource" = 'US_STATE');

INSERT INTO "ChoiceList" ("id", "name", "description", "choiceSource", "parentListId")
SELECT 'list_us_cities', 'US Cities', 'Cities in the correlated US state.', 'US_CITY', 'list_us_states'
WHERE NOT EXISTS (SELECT 1 FROM "ChoiceList" WHERE "choiceSource" = 'US_CITY');

UPDATE "FieldDefinition"
SET "choiceListId" = 'list_us_states'
WHERE "choiceSource" = 'US_STATE' AND "choiceListId" IS NULL;

UPDATE "FieldDefinition"
SET "choiceListId" = 'list_us_cities'
WHERE "choiceSource" = 'US_CITY' AND "choiceListId" IS NULL;

INSERT INTO "ChoiceList" ("id", "name", "description", "isActive")
SELECT 'list_' || f."id", f."friendlyName", f."description", true
FROM "FieldDefinition" f
WHERE f."dataType" IN ('DROPDOWN', 'RADIO')
  AND f."choiceSource" = 'MANUAL'
  AND f."choiceListId" IS NULL;

INSERT INTO "ChoiceListItem" ("id", "listId", "label", "value", "parentValues", "isDefault", "sortOrder")
SELECT 'item_' || o."id", 'list_' || o."fieldId", o."label", o."value", o."parentValues", o."isDefault", o."sortOrder"
FROM "FieldOption" o
JOIN "FieldDefinition" f ON f."id" = o."fieldId"
WHERE f."dataType" IN ('DROPDOWN', 'RADIO')
  AND f."choiceSource" = 'MANUAL'
  AND f."choiceListId" IS NULL;

UPDATE "FieldDefinition"
SET "choiceListId" = 'list_' || "id"
WHERE "dataType" IN ('DROPDOWN', 'RADIO')
  AND "choiceSource" = 'MANUAL'
  AND "choiceListId" IS NULL;

UPDATE "ChoiceList" AS child
SET "parentListId" = parent_field."choiceListId"
FROM "FieldDefinition" AS child_field
JOIN "FieldDefinition" AS parent_field ON parent_field."id" = child_field."parentFieldId"
WHERE child."id" = child_field."choiceListId"
  AND child_field."choiceListId" IS NOT NULL
  AND parent_field."choiceListId" IS NOT NULL
  AND child."parentListId" IS NULL;
