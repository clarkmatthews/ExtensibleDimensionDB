-- Share API secrets: keep only a SHA-256 hash and a short hint.
ALTER TABLE "ApiEndpoint" ADD COLUMN "secretHash" TEXT;
ALTER TABLE "ApiEndpoint" ADD COLUMN "secretHint" TEXT NOT NULL DEFAULT '';
UPDATE "ApiEndpoint"
SET "secretHash" = encode(sha256(convert_to("secret", 'UTF8')), 'hex'),
    "secretHint" = right("secret", 4);
ALTER TABLE "ApiEndpoint" ALTER COLUMN "secretHash" SET NOT NULL;
ALTER TABLE "ApiEndpoint" DROP COLUMN "secret";

-- Share API failure tracking is keyed by endpoint and caller, not by address alone.
DELETE FROM "ApiIpBlock";
ALTER TABLE "ApiIpBlock" RENAME COLUMN "sourceIp" TO "key";

-- Login throttling keys change shape; start clean.
DELETE FROM "LoginLock";

-- Server-side sessions.
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Administrative audit log.
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit log screen.
ALTER TYPE "AppModule" ADD VALUE 'AUDIT';
