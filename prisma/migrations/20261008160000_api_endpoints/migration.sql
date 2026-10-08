CREATE TYPE "ApiFormat" AS ENUM ('JSON', 'XML');

ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'API_CONFIG';

CREATE TABLE "ApiEndpoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "secret" TEXT NOT NULL,
    "format" "ApiFormat" NOT NULL DEFAULT 'JSON',
    "validFrom" DATE,
    "validTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiEndpointCategory" (
    "endpointId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "applyToFields" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ApiEndpointCategory_pkey" PRIMARY KEY ("endpointId","categoryId")
);

CREATE TABLE "ApiEndpointField" (
    "endpointId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,

    CONSTRAINT "ApiEndpointField_pkey" PRIMARY KEY ("endpointId","fieldId")
);

CREATE TABLE "ApiRequestLog" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceIp" TEXT NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL,
    "result" TEXT NOT NULL,

    CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiRequestLog_endpointId_createdAt_idx" ON "ApiRequestLog"("endpointId", "createdAt");

ALTER TABLE "ApiEndpointCategory" ADD CONSTRAINT "ApiEndpointCategory_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ApiEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiEndpointCategory" ADD CONSTRAINT "ApiEndpointCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApiEndpointField" ADD CONSTRAINT "ApiEndpointField_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ApiEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiEndpointField" ADD CONSTRAINT "ApiEndpointField_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ApiEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
