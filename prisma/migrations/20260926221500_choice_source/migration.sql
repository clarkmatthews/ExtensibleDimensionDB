-- CreateEnum
CREATE TYPE "ChoiceSource" AS ENUM ('MANUAL', 'US_STATE', 'US_CITY');

-- AlterTable
ALTER TABLE "FieldDefinition" ADD COLUMN "choiceSource" "ChoiceSource" NOT NULL DEFAULT 'MANUAL';
