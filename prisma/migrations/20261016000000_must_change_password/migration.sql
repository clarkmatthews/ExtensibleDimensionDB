-- People whose password someone else chose pick their own at their next sign-in.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Accounts that have never signed in still have the password an administrator gave them.
UPDATE "User" u SET "mustChangePassword" = true
WHERE NOT u."isAdmin" AND u."oidcSubject" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Session" s WHERE s."userId" = u.id);
