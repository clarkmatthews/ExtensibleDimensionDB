ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'EMAIL_CONFIG';

CREATE TYPE "MailSecurity" AS ENUM ('NONE', 'STARTTLS', 'TLS');

CREATE TABLE "MailSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 587,
    "security" "MailSecurity" NOT NULL DEFAULT 'STARTTLS',
    "rejectUnauthorized" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT '',
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailSettings_pkey" PRIMARY KEY ("id")
);
