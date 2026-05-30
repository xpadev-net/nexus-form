#!/usr/bin/env node

import { readFileSync } from "node:fs";

const probeMode = process.argv[2];
if (probeMode !== "liveness" && probeMode !== "readiness") {
  process.exit(1);
}

const healthPath = process.env.WORKER_HEALTH_FILE ?? "/tmp/nexus-form-worker-health.json";

const shouldExitOne = () => {
  process.exit(1);
};

let raw;
try {
  raw = readFileSync(healthPath, "utf8");
} catch {
  shouldExitOne();
}

if (!raw) {
  shouldExitOne();
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  shouldExitOne();
}

if (!data) {
  shouldExitOne();
}

if (typeof data.lastBeat !== "number" || !Number.isFinite(data.lastBeat)) {
  shouldExitOne();
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
  shouldExitOne();
}

if (probeMode === "readiness" && data.ready !== true) {
  shouldExitOne();
}

process.exit(0);
