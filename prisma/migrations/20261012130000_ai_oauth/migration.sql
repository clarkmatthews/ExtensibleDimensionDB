CREATE TYPE "AiProduct" AS ENUM ('CHATGPT', 'CLAUDE', 'GROK');

CREATE TABLE "AiOauthSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "allowChatGpt" BOOLEAN NOT NULL DEFAULT false,
    "allowClaude" BOOLEAN NOT NULL DEFAULT false,
    "allowGrok" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiOauthSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OauthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "product" "AiProduct" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OauthClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OauthClient_clientId_key" ON "OauthClient"("clientId");

CREATE TABLE "OauthConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oauthClientId" TEXT NOT NULL,
    "product" "AiProduct" NOT NULL,
    "name" TEXT NOT NULL,
    "allowRead" BOOLEAN NOT NULL DEFAULT true,
    "allowPropose" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "OauthConnection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OauthConnection_userId_idx" ON "OauthConnection"("userId");

CREATE TABLE "OauthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "oauthClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "allowRead" BOOLEAN NOT NULL,
    "allowPropose" BOOLEAN NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OauthCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OauthCode_codeHash_key" ON "OauthCode"("codeHash");
CREATE INDEX "OauthCode_userId_idx" ON "OauthCode"("userId");

CREATE TABLE "OauthRefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OauthRefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OauthRefreshToken_tokenHash_key" ON "OauthRefreshToken"("tokenHash");
CREATE INDEX "OauthRefreshToken_connectionId_idx" ON "OauthRefreshToken"("connectionId");

ALTER TABLE "AccessToken" ADD COLUMN "connectionId" TEXT;
CREATE INDEX "AccessToken_connectionId_idx" ON "AccessToken"("connectionId");

ALTER TABLE "OauthConnection" ADD CONSTRAINT "OauthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OauthConnection" ADD CONSTRAINT "OauthConnection_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "OauthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OauthCode" ADD CONSTRAINT "OauthCode_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "OauthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OauthCode" ADD CONSTRAINT "OauthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OauthRefreshToken" ADD CONSTRAINT "OauthRefreshToken_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OauthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OauthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
