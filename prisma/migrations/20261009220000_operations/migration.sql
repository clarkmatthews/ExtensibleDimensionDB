-- Record archiving.
ALTER TABLE "Location" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Location" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "StoreProcess" ADD COLUMN "suspendedByArchive" BOOLEAN NOT NULL DEFAULT false;

-- Built-in scheduler bookkeeping.
CREATE TABLE "JobRun" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastResult" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("name")
);
