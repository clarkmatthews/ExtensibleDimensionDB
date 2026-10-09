#!/bin/sh
# Applies migrations, seeds an empty database once, then starts the app.
set -e
npx prisma migrate deploy
if node scripts/needs-seed.mjs; then
  echo "Empty database: running the first-time seed."
  npx tsx prisma/seed.ts
fi
exec "$@"
