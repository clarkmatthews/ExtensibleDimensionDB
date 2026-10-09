ALTER TYPE "AppModule" ADD VALUE 'SSO';

ALTER TABLE "User" ADD COLUMN "oidcSubject" TEXT;
CREATE UNIQUE INDEX "User_oidcSubject_key" ON "User"("oidcSubject");

CREATE TABLE "SsoSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuer" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL DEFAULT '',
    "clientSecret" TEXT NOT NULL DEFAULT '',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Sign in with SSO',
    "allowedDomains" TEXT[],
    "createUsers" BOOLEAN NOT NULL DEFAULT false,
    "defaultGroupId" TEXT,
    "passwordAdminOnly" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SsoSettings_pkey" PRIMARY KEY ("id")
);
