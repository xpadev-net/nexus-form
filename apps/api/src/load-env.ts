import { resolve } from "node:path";
import { loadEnvFileSync } from "@nexus-form/shared/node/load-env";
import { validateBucketName } from "./lib/s3/bucket-name";

const requiredS3BucketEnvNames = ["S3_BUCKET_TMP", "S3_BUCKET_PROD"] as const;

function formatNodeEnv(nodeEnv: string | undefined): string {
  return nodeEnv && nodeEnv.length > 0 ? nodeEnv : "unset";
}

function assertS3BucketEnvironment(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  for (const envName of requiredS3BucketEnvNames) {
    const value = process.env[envName]?.trim();
    if (!value) {
      throw new Error(
        `${envName} is required when NODE_ENV is ${formatNodeEnv(process.env.NODE_ENV)}. S3 bucket fallback is limited to development and test.`,
      );
    }

    if (!validateBucketName(value)) {
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
