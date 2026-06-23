import { resolve } from "node:path";
import { loadEnvFileSync } from "@nexus-form/shared/node/load-env";

const localS3BucketFallbackEnvironments = new Set(["development", "test"]);
const requiredS3BucketEnvNames = ["S3_BUCKET_TMP", "S3_BUCKET_PROD"] as const;

function isValidS3BucketName(bucketName: string): boolean {
  const bucketNameRegex = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

  if (bucketName.length < 3 || bucketName.length > 63) {
    return false;
  }

  if (!bucketNameRegex.test(bucketName)) {
    return false;
  }

  if (
    bucketName.includes("..") ||
    bucketName.includes(".-") ||
    bucketName.includes("-.")
  ) {
    return false;
  }

  return !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucketName);
}

function formatNodeEnv(nodeEnv: string | undefined): string {
  return nodeEnv && nodeEnv.length > 0 ? nodeEnv : "unset";
}

function assertS3BucketEnvironment(): void {
  if (localS3BucketFallbackEnvironments.has(process.env.NODE_ENV ?? "")) {
    return;
  }

  for (const envName of requiredS3BucketEnvNames) {
    const value = process.env[envName]?.trim();
    if (!value) {
      throw new Error(
        `${envName} is required when NODE_ENV is ${formatNodeEnv(process.env.NODE_ENV)}. S3 bucket fallback is limited to development and test.`,
      );
    }

    if (!isValidS3BucketName(value)) {
      throw new Error(`Invalid S3 bucket name in ${envName}: ${value}`);
    }
  }
}

loadEnvFileSync({
  enabled: process.env.NODE_ENV !== "production",
  path: resolve(import.meta.dirname, "../../../.env.local"),
  moduleUrl: import.meta.url,
});

assertS3BucketEnvironment();
