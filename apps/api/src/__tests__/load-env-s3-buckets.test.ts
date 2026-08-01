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

function getTopLevelCallExpressions(source: string): string[] {
  const clean = sanitizeCode(source);
  let braceDepth = 0;
  let parenDepth = 0;
  let currentToken = "";
  let lastWord = "";
  const calls: string[] = [];

  const keywords = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "throw",
    "function",
    "const",
    "let",
    "var",
    "export",
    "import",
    "type",
    "interface",
  ]);

  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (!ch) {
      i++;
      continue;
    }

    if (ch === "{") {
      braceDepth++;
      currentToken = "";
      i++;
      continue;
    }
    if (ch === "}") {
      if (braceDepth > 0) braceDepth--;
      currentToken = "";
      i++;
      continue;
    }

    if (braceDepth === 0) {
      if (ch === "(") {
        const name = currentToken.trim();
        if (
          name &&
          /^[a-zA-Z0-9_$]+$/.test(name) &&
          !keywords.has(name) &&
          lastWord !== "function" &&
          lastWord !== "=>" &&
          name !== "resolve"
        ) {
          calls.push(name);
        }
        parenDepth++;
        currentToken = "";
      } else if (ch === ")") {
        if (parenDepth > 0) parenDepth--;
        currentToken = "";
      } else if (/\s/.test(ch)) {
        if (currentToken.trim()) {
          lastWord = currentToken.trim();
        }
        currentToken = "";
      } else if (/[a-zA-Z0-9_$]/.test(ch)) {
        currentToken += ch;
      } else {
        if (ch === "=" && clean[i + 1] === ">") {
          lastWord = "=>";
          i += 2;
          continue;
        }
        currentToken = "";
      }
    }
    i++;
  }

  return calls;
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
