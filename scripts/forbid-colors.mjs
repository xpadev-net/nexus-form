#!/usr/bin/env node
/**
 * Forbid hardcoded colors on staged files only.
 * Usage: node scripts/forbid-colors.mjs <file1> <file2> ...
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const args = process.argv.slice(2).filter(Boolean);
const scanAll = args.includes("--all");
const inputFiles = args.filter((a) => a !== "--all");

// File extensions to check
const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".md",
  ".mdx",
]);

// Ignore patterns
const IGNORE_DIRS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.next${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}playwright-report${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}tests${path.sep}`,
  `${path.sep}e2e${path.sep}`,
  `${path.sep}test-helpers${path.sep}`,
  `apps${path.sep}web${path.sep}src${path.sep}components${path.sep}ui${path.sep}`, // shadcn/ui components may contain hardcoded colors for design token purposes, but we allow them since they are part of the design system and not user code.
];

// Files that require hex colors for functional reasons (e.g., email templates, validation schemas).
// Paths are matched as suffixes against forward-slash normalized file paths.
const IGNORE_FILES = [
  "apps/api/src/lib/services/email-service.ts",
  "packages/shared/src/validation/appearance.ts",
  "packages/shared/src/branding.ts",
];

// Build single regex to detect forbidden patterns
// - Tailwind grayscale families
// - hex colors
// - rgb/rgba(
const pattern = new RegExp(
  [
    String.raw`\bbg-(?:white|black|gray|neutral|stone|slate|zinc)(?:-[0-9]{1,3})?(?:\/\d+)?\b`,
    String.raw`\btext-(?:white|black|gray|neutral|stone|slate|zinc)(?:-[0-9]{1,3})?(?:\/\d+)?\b`,
    String.raw`\b(?:border|ring)-(?:gray|neutral|stone|slate|zinc)(?:-[0-9]{1,3})?(?:\/\d+)?\b`,
    String.raw`#[0-9A-Fa-f]{3,8}\b`,
    String.raw`rgba?\s*\(`,
  ].join("|"),
  "g",
);

function isTestFile(filePath) {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  const normalized = filePath.split(path.sep).join(path.sep);

  // Check by file name pattern (e.g., *.test.ts, *.spec.tsx)
  const byName = /(test|spec)\.[a-z0-9]+$/i.test(lower);
  if (byName) return true;

  // Check by directory name
  const segments = normalized.split(path.sep);
  const inTestDir = segments.some(
    (seg) =>
      seg === "__tests__" ||
      seg === "tests" ||
      seg === "e2e" ||
      seg === "test-helpers" ||
      seg === "__tests" ||
      seg.startsWith("test-") ||
      seg.endsWith("-test"),
  );
  if (inTestDir) return true;

  // Check by path pattern
  const testPathPatterns = [
    /[/\\]__tests__[/\\]/i,
    /[/\\]tests[/\\]/i,
    /[/\\]e2e[/\\]/i,
    /[/\\]test-helpers[/\\]/i,
    /[/\\]test-setup[/\\]/i,
  ];
  if (testPathPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return false;
}

function isIgnored(filePath) {
  if (!filePath) return true;
  const ext = path.extname(filePath);
  if (!ALLOWED_EXTENSIONS.has(ext)) return true;
  if (isTestFile(filePath)) return true;
  const normalized = filePath.split(path.sep).join(path.sep);
  if (IGNORE_DIRS.some((d) => normalized.includes(d))) return true;
  // Check if file path matches ignore list (suffix match on forward-slash normalized paths)
  const fwdSlash = filePath.split(path.sep).join("/");
  if (IGNORE_FILES.some((f) => fwdSlash.endsWith(f))) return true;
  return false;
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

let targets = [];

if (scanAll) {
  // Collect all tracked and untracked files under src/**, apps/**/src/**, packages/**/src/**
  try {
    // Get tracked files
    const trackedOut = execSync(
      'git ls-files -- "src/**" "apps/**/src/**" "packages/**/src/**"',
      { encoding: "utf8" },
    );
    const trackedFiles = trackedOut.split(/\r?\n/).filter(Boolean);
    // Get untracked files (excluding .gitignore patterns)
    const untrackedOut = execSync(
      'git ls-files --others --exclude-standard -- "src/**" "apps/**/src/**" "packages/**/src/**"',
      { encoding: "utf8" },
    );
    const untrackedFiles = untrackedOut.split(/\r?\n/).filter(Boolean);
    // Merge and deduplicate using Set
    const allFiles = Array.from(new Set([...trackedFiles, ...untrackedFiles]));
    targets = allFiles.filter((f) => !isIgnored(f) && fileExists(f));
  } catch (e) {
    console.error("Failed to list repository files via git:", e?.message || e);
    process.exit(2);
  }
} else {
  targets = inputFiles.filter((f) => !isIgnored(f) && fileExists(f));
}

if (targets.length === 0) {
  console.log(
    scanAll
      ? "No relevant files to check"
      : "No relevant staged files to check",
  );
  process.exit(0);
}

const violations = [];

// Pattern to match CSS attribute selectors with hex colors (e.g., [stroke='#ccc'], [fill="#fff"])
// These should be excluded from the forbidden color check
const attributeSelectorPattern = /\[[^\]]*['"]#[0-9A-Fa-f]{3,8}['"][^\]]*\]/g;

function maskAttributeSelectors(content) {
  // Replace hex colors in attribute selectors with a placeholder
  return content.replace(attributeSelectorPattern, (match) => {
    return match.replace(/#[0-9A-Fa-f]{3,8}/g, "HEX_COLOR_PLACEHOLDER");
  });
}

for (const file of targets) {
  const content = fs.readFileSync(file, "utf8");
  // Mask hex colors in CSS attribute selectors before checking for forbidden patterns
  const maskedContent = maskAttributeSelectors(content);
  // Allow list: if content includes shadcn token classes, it's fine; we still check for hardcoded
  const matches = maskedContent.match(pattern);
  if (matches) {
    violations.push({ file, matches: Array.from(new Set(matches)) });
  }
}

if (violations.length > 0) {
  console.error("Forbidden color patterns detected in staged files:\n");
  for (const v of violations) {
    console.error(`- ${v.file}`);
    for (const m of v.matches.slice(0, 10)) {
      console.error(`  ? ${m}`);
    }
    if (v.matches.length > 10) {
      console.error(`  ? ... and ${v.matches.length - 10} more`);
    }
  }
  console.error(
    "\nPlease replace with design tokens (e.g., bg-card, bg-muted, text-foreground, border-border, ring-ring, bg-overlay).\n",
  );
  process.exit(1);
}

console.log("No forbidden colors in staged files");
process.exit(0);
