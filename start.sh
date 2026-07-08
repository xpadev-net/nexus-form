#!/usr/bin/env sh

set -eu

if [ -f /migration/run-migrations.mjs ]; then
  DRIZZLE_MIGRATIONS_DIR="${DRIZZLE_MIGRATIONS_DIR:-/migration/drizzle}" node /migration/run-migrations.mjs
fi

node ./apps/api/dist/index.mjs
