ALTER TYPE "AppModule" ADD VALUE 'AI_ACCESS';
ALTER TYPE "AppModule" ADD VALUE 'PROPOSALS';

CREATE TABLE "AccessToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AccessToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccessToken_tokenHash_key" ON "AccessToken"("tokenHash");
CREATE INDEX "AccessToken_userId_idx" ON "AccessToken"("userId");
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChangeProposal" (
    "id" TEXT NOT NULL,
    "recordTypeId" TEXT NOT NULL,
    "locationId" TEXT,
    "proposedById" TEXT NOT NULL,
    "tokenId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "appliedLocationId" TEXT,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangeProposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChangeProposal_status_createdAt_idx" ON "ChangeProposal"("status", "createdAt");
CREATE INDEX "ChangeProposal_proposedById_idx" ON "ChangeProposal"("proposedById");
ALTER TABLE "ChangeProposal" ADD CONSTRAINT "ChangeProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChangeProposal" ADD CONSTRAINT "ChangeProposal_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AccessToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangeProposal" ADD CONSTRAINT "ChangeProposal_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FieldChange" ADD COLUMN "proposalId" TEXT;
ALTER TABLE "FieldChange" ADD CONSTRAINT "FieldChange_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ChangeProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
