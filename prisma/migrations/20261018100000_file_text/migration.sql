-- The readable text of stored files, so AI tools can read and search them.
ALTER TABLE "StoredFile" ADD COLUMN "text" TEXT;
ALTER TABLE "StoredFile" ADD COLUMN "textError" TEXT NOT NULL DEFAULT '';
