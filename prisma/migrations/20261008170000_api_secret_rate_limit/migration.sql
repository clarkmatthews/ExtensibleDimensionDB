ALTER TABLE "ApiEndpoint" ADD COLUMN "secretOptional" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ApiIpBlock" (
    "sourceIp" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiIpBlock_pkey" PRIMARY KEY ("sourceIp")
);
