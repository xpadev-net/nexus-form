import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveS3BucketConfig } from "../lib/s3/utils";

const repoRoot = resolve(import.meta.dirname, "../../../..");

function sanitizeCode(src: string): string {
  let result = "";
  let i = 0;
  const len = src.length;

  while (i < len) {
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i];
      i++;
      while (i < len && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      if (i < len) i++;
      result += '""';
      continue;
    }
    if (src[i] === "`") {
      i++;
      let depth = 0;
      while (i < len) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "`" && depth === 0) {
          i++;
          break;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          depth++;
          i += 2;
          continue;
        }
        if (src[i] === "}" && depth > 0) {
          depth--;
          i++;
          continue;
        }
        i++;
      }
      result += '""';
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < len && src[i] !== "\n" && src[i] !== "\r") i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i < len) i += 2;
      continue;
    }
    result += src[i];
    i++;
  }
  return result;
}

function stripFunctionDeclarations(src: string): string {
  let result = "";
  let i = 0;
  const len = src.length;

  while (i < len) {
    const match = src
      .slice(i)
      .match(/^function(?:\s*\*|\s+[a-zA-Z0-9_$]+|\s*\()/);
    if (match) {
      while (i < len && src[i] !== "{") i++;
      if (i < len && src[i] === "{") {
        let depth = 1;
        i++;
        while (i < len && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          i++;
        }
      }
      continue;
    }
    result += src[i];
    i++;
  }
  return result;
}

function getTopLevelCallExpressions(source: string): string[] {
  const sanitized = sanitizeCode(source);
  const topLevel = stripFunctionDeclarations(sanitized);
  const keywords = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "throw",
    "function",
  ]);
  const matches = Array.from(topLevel.matchAll(/\b([a-zA-Z0-9_$]+)\s*\(/g)).map(
    (m) => m[1],
  );
  return matches.filter(
    (name: string | undefined): name is string =>
      typeof name === "string" && !keywords.has(name) && name !== "resolve",
  );
}

describe("load-env S3 bucket validation", () => {
  it("validates S3 buckets after synchronous dotenv loading", () => {
    const source = readFileSync(
      resolve(repoRoot, "apps/api/src/load-env.ts"),
      "utf8",
    );
    const callExpressions = getTopLevelCallExpressions(source);

    expect(callExpressions).toEqual([
      "loadEnvFileSync",
      "assertS3BucketEnvironment",
    ]);
  });

  it("documents that local fallback is limited to development and test", () => {
    const loadEnvSource = readFileSync(
      resolve(repoRoot, "apps/api/src/load-env.ts"),
      "utf8",
    );
    const utilsSource = readFileSync(
      resolve(repoRoot, "apps/api/src/lib/s3/utils.ts"),
      "utf8",
    );

    expect(loadEnvSource).toContain('process.env.NODE_ENV !== "production"');
    expect(utilsSource).toContain('"development", "test"');
    expect(utilsSource).toContain("S3_BUCKET_TMP");
    expect(utilsSource).toContain("S3_BUCKET_PROD");
    expect(utilsSource).toContain(
      "S3 bucket fallback is limited to development and test",
    );
  });

  it("fails fast for missing and invalid bucket env outside local/test", () => {
    expect(() =>
      resolveS3BucketConfig({
        NODE_ENV: "production",
        S3_BUCKET_PROD: "nexus-form-prod",
      }),
    ).toThrow(/S3_BUCKET_TMP is required/);

    expect(() =>
      resolveS3BucketConfig({
        NODE_ENV: "production",
        S3_BUCKET_TMP: "Invalid_Bucket",
        S3_BUCKET_PROD: "nexus-form-prod",
      }),
    ).toThrow(/Invalid S3 bucket name in S3_BUCKET_TMP/);
  });
});
