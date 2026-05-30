#!/usr/bin/env node

import { readFileSync } from "node:fs";

const probeMode = process.argv[2];
if (probeMode !== "liveness" && probeMode !== "readiness") {
  process.exit(1);
}

const healthPath = process.env.WORKER_HEALTH_FILE ?? "/tmp/nexus-form-worker-health.json";

let raw;
try {
  raw = readFileSync(healthPath, "utf8");
} catch {
  process.exit(1);
}

if (!raw) {
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(1);
}

if (!data) {
  process.exit(1);
}

if (typeof data.lastBeat !== "number" || !Number.isFinite(data.lastBeat)) {
  process.exit(1);
}

const interval = Number(data.heartbeatIntervalMs);
const envMaxAge = Number(process.env.WORKER_HEALTH_MAX_AGE_MS);
const maxAge =
  Number.isFinite(envMaxAge) && envMaxAge > 0
    ? envMaxAge
    : Number.isFinite(interval) && interval > 0
      ? interval * 3
      : 15000;

if (Date.now() - data.lastBeat > maxAge) {
  process.exit(1);
}

if (probeMode === "readiness" && data.ready !== true) {
  process.exit(1);
}

process.exit(0);
