#!/bin/sh
set -e

# Automatically sync database schema if DATABASE_URL is configured
if [ -n "$DATABASE_URL" ]; then
  echo "==> Running Prisma schema push to database..."
  npx prisma db push --skip-generate || echo "==> Notice: Prisma db push completed with status $?"
fi

echo "==> Starting Spotify Sync Room Backend on port ${PORT:-5000}..."
exec "$@"
