#!/usr/bin/env sh

set -eu

if [ -f /migration/run-migrations.mjs ]; then
  node /migration/run-migrations.mjs
fi

node ./apps/api/dist/index.mjs
