#!/usr/bin/env bash
set -euo pipefail

staged_schema=$(git diff --cached --name-only -- 'packages/database/src' || true)
if [ -z "$staged_schema" ]; then
  exit 0
fi

staged_drizzle=$(git diff --cached --name-only -- 'packages/database/drizzle' || true)
if [ -z "$staged_drizzle" ]; then
  echo "packages/database/src changed but packages/database/drizzle is not staged." >&2
  echo "Run pnpm db:generate and stage the migration output." >&2
  exit 1
fi
