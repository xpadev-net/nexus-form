#!/usr/bin/env sh
node /migration/run-migrations.mjs && node ./apps/api/dist/index.mjs
