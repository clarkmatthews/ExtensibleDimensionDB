-- Minutes without activity before a browser sign-in ends; 0 turns the timeout off.
ALTER TABLE "SiteSettings" ADD COLUMN "sessionIdleMinutes" INTEGER NOT NULL DEFAULT 30;
