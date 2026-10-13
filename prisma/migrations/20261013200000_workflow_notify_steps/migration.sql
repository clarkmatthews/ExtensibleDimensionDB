CREATE TYPE "StepKind" AS ENUM ('ACTION', 'NOTIFY');
ALTER TABLE "WorkflowStep" ADD COLUMN "kind" "StepKind" NOT NULL DEFAULT 'ACTION';
ALTER TABLE "WorkflowStep" ALTER COLUMN "groupId" DROP NOT NULL;

ALTER TABLE "Notification" ADD COLUMN "locationId" TEXT;
CREATE INDEX "Notification_locationId_idx" ON "Notification"("locationId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
