-- People follow records; the dashboard shows other people's edits to them.
CREATE TABLE "RecordWatch" (
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordWatch_pkey" PRIMARY KEY ("userId", "locationId")
);
CREATE INDEX "RecordWatch_locationId_idx" ON "RecordWatch"("locationId");
ALTER TABLE "RecordWatch" ADD CONSTRAINT "RecordWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecordWatch" ADD CONSTRAINT "RecordWatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "dashboardSeenAt" TIMESTAMP(3);

-- Start everyone off watching the records they edited in the last 90 days, as saving a record now does.
INSERT INTO "RecordWatch" ("userId", "locationId")
SELECT DISTINCT fc."userId", fc."locationId"
FROM "FieldChange" fc
JOIN "Location" l ON l.id = fc."locationId" AND l."isActive"
WHERE fc."createdAt" > now() - interval '90 days' AND fc."proposalId" IS NULL
ON CONFLICT DO NOTHING;
