import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const originalEnv = process.env;
const imageEnvNames = [
  "MAX_FILE_SIZE_MB",
  "ALLOWED_IMAGE_TYPES",
  "MAX_IMAGE_SIZE",
  "MAX_IMAGE_DIMENSION",
  "MAX_IMAGE_PIXELS",
] as const;

function readEnvExampleValue(name: string): string {
  const source = readFileSync(resolve(repoRoot, ".env.example"), "utf8");
  const match = new RegExp(`^${name}=(.+)$`, "m").exec(source);
  const value = match?.[1]?.trim();

  if (!value) {
    throw new Error(`${name} is missing from .env.example`);
  }

  return value;
}

describe("image processing environment schema", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, NODE_ENV: "test" };
    for (const envName of imageEnvNames) {
      delete process.env[envName];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("keeps .env.example upload and processing limits in parity", async () => {
    process.env.MAX_FILE_SIZE_MB = readEnvExampleValue("MAX_FILE_SIZE_MB");
    process.env.ALLOWED_IMAGE_TYPES = readEnvExampleValue(
      "ALLOWED_IMAGE_TYPES",
    );

    const imageProcessing = await import("./image-processing");
    const s3Validation = await import("../lib/s3/validation");

    expect(imageProcessing.IMAGE_PROCESSING_LIMITS.MAX_FILE_SIZE).toBe(
      10 * 1024 * 1024,
    );
    expect(s3Validation.DEFAULT_VALIDATION_CONFIG.maxSize).toBe(
      imageProcessing.IMAGE_PROCESSING_LIMITS.MAX_FILE_SIZE,
    );
    expect(s3Validation.DEFAULT_VALIDATION_CONFIG.allowedTypes).toEqual(
      imageProcessing.IMAGE_UPLOAD_LIMITS.ALLOWED_TYPES,
    );
    expect(s3Validation.DEFAULT_VALIDATION_CONFIG.allowedExtensions).toEqual(
      imageProcessing.IMAGE_UPLOAD_LIMITS.ALLOWED_EXTENSIONS,
    );
    expect(s3Validation.DEFAULT_VALIDATION_CONFIG.allowSvg).toBe(false);
    expect(
      imageProcessing.IMAGE_PROCESSING_LIMITS.SUPPORTED_INPUT_FORMATS,
    ).toEqual(["jpeg", "png", "webp", "gif"]);
  });

  it("uses MAX_FILE_SIZE_MB and ALLOWED_IMAGE_TYPES for upload and processing", async () => {
    process.env.MAX_FILE_SIZE_MB = "2";
    process.env.ALLOWED_IMAGE_TYPES = "image/png";

    const imageProcessing = await import("./image-processing");
    const s3Validation = await import("../lib/s3/validation");

    expect(imageProcessing.IMAGE_PROCESSING_LIMITS.MAX_FILE_SIZE).toBe(
      2 * 1024 * 1024,
    );
    expect(s3Validation.DEFAULT_VALIDATION_CONFIG.maxSize).toBe(
      imageProcessing.IMAGE_PROCESSING_LIMITS.MAX_FILE_SIZE,
    );
    expect(s3Validation.DEFAULT_VALIDATION_CONFIG.allowedTypes).toEqual([
      "image/png",
    ]);
    expect(s3Validation.DEFAULT_VALIDATION_CONFIG.allowedExtensions).toEqual([
      ".png",
    ]);
    expect(
      imageProcessing.IMAGE_PROCESSING_LIMITS.SUPPORTED_INPUT_FORMATS,
    ).toEqual(["png"]);
  });

  it("keeps deprecated MAX_IMAGE_SIZE as a warning-backed compatibility input", async () => {
    const { parseImageEnvironment } = await import("./image-processing");

    expect(
      parseImageEnvironment({
        MAX_IMAGE_SIZE: String(1024 * 1024),
      }).maxFileSizeBytes,
    ).toBe(1024 * 1024);
  });

  it("rejects invalid image env values", async () => {
    const { parseImageEnvironment } = await import("./image-processing");

    expect(() => parseImageEnvironment({ MAX_FILE_SIZE_MB: "0" })).toThrow();
    expect(() =>
      parseImageEnvironment({
        ALLOWED_IMAGE_TYPES: "image/jpeg,text/plain",
      }),
    ).toThrow();
  });
});
