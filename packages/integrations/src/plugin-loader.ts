/**
 * Validation Provider Plugin Loader
 *
 * ファイルシステムからPluginを読み込む
 */

import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import type { ValidationProvider } from "./plugin-interface";

const VALID_PLUGIN_EXTENSIONS = [".js", ".mjs"];
const PLUGIN_LOCK_FILE = "plugins.lock";
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pluginLockSchema = z
  .object({
    plugins: z.record(z.string().min(1), sha256Schema),
  })
  .strict();

type PluginLock = z.infer<typeof pluginLockSchema>;

function isValidPluginFile(filename: string): boolean {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const ext = filename.substring(dotIndex);
  return VALID_PLUGIN_EXTENSIONS.includes(ext) && !filename.startsWith(".");
}

function hasUnsafeDirectoryPermissions(mode: number): boolean {
  return (mode & 0o022) !== 0;
}

async function readPluginLock(resolvedDir: string): Promise<PluginLock | null> {
  let rawLock: string;
  try {
    rawLock = await readFile(join(resolvedDir, PLUGIN_LOCK_FILE), "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }

  let parsedLock: unknown;
  try {
    parsedLock = JSON.parse(rawLock);
  } catch {
    throw new Error(`${PLUGIN_LOCK_FILE} must contain valid JSON`);
  }

  const result = pluginLockSchema.safeParse(parsedLock);
  if (!result.success) {
    throw new Error(`${PLUGIN_LOCK_FILE} has an invalid schema`);
  }
  return result.data;
}

async function computeSha256(path: string): Promise<string | null> {
  return readFile(path)
    .then((buf) => createHash("sha256").update(buf).digest("hex"))
    .catch(() => null);
}

export type PluginLoadOutcome =
  | { kind: "ok"; provider: ValidationProvider }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string };

export async function loadPluginFromSpecifier(
  specifier: string,
): Promise<PluginLoadOutcome> {
  let module: { default?: unknown; provider?: unknown };
  try {
    module = await import(specifier);
  } catch (error) {
    return {
      kind: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const provider = module.default ?? module.provider;
  if (!provider) {
    return { kind: "skipped", reason: "No default export" };
  }
  if (!isValidationProvider(provider)) {
    return { kind: "skipped", reason: "Invalid provider interface" };
  }
  return { kind: "ok", provider };
}

function isValidIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-z][a-z0-9_]*$/.test(value)
  );
}

function hasParseSchema(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).parse === "function"
  );
}

function hasSafeParseSchema(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).safeParse === "function"
  );
}

function isValidationProviderRule(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const rule = obj as Record<string, unknown>;
  if (!isValidIdentifier(rule.name)) return false;
  return (
    typeof rule.label === "string" &&
    typeof rule.description === "string" &&
    typeof rule.inputHint === "string" &&
    typeof rule.validate === "function" &&
    hasParseSchema(rule.inputSchema) &&
    hasParseSchema(rule.configSchema) &&
    hasSafeParseSchema(rule.metadataSchema) &&
    (rule.sanitizeConfig === undefined ||
      typeof rule.sanitizeConfig === "function") &&
    (rule.normalizeInput === undefined ||
      typeof rule.normalizeInput === "function")
  );
}

function isValidationProvider(obj: unknown): obj is ValidationProvider {
  if (typeof obj !== "object" || obj === null) return false;
  const provider = obj as Record<string, unknown>;

  if (!isValidIdentifier(provider.name)) return false;
  if (
    typeof provider.label !== "string" ||
    typeof provider.description !== "string"
  ) {
    return false;
  }

  const rules = provider.rules;
  if (typeof rules !== "object" || rules === null) return false;
  const ruleEntries = Object.entries(rules as Record<string, unknown>);
  if (ruleEntries.length === 0) return false;
  for (const [ruleType, rule] of ruleEntries) {
    if (!isValidIdentifier(ruleType)) return false;
    if (!isValidationProviderRule(rule)) return false;
    if ((rule as { name: unknown }).name !== ruleType) return false;
  }
  return true;
}

export class PluginLoader {
  private pluginsDir: string;
  private failedPlugins: Array<{ file: string; error: string }> = [];

  constructor(pluginsDir: string) {
    this.pluginsDir = pluginsDir;
  }

  getFailedPlugins(): Array<{ file: string; error: string }> {
    return [...this.failedPlugins];
  }

  hasFailedPlugins(): boolean {
    return this.failedPlugins.length > 0;
  }

  async loadPlugins(): Promise<ValidationProvider[]> {
    let resolvedDir: string;
    try {
      const dirStat = await stat(this.pluginsDir);
      if (!dirStat.isDirectory()) {
        console.warn(`[PluginLoader] Not a directory: ${this.pluginsDir}`);
        return [];
      }
      if (hasUnsafeDirectoryPermissions(dirStat.mode)) {
        console.error(
          `[PluginLoader] Refusing to load plugins from group/other writable directory: ${this.pluginsDir}`,
        );
        return [];
      }
      resolvedDir = await realpath(this.pluginsDir);
    } catch {
      console.warn(
        `[PluginLoader] Directory does not exist or cannot be resolved: ${this.pluginsDir}`,
      );
      return [];
    }

    const files = await readdir(resolvedDir).catch(() => []);
    const plugins: ValidationProvider[] = [];
    let pluginLock: PluginLock | null;
    try {
      pluginLock = await readPluginLock(resolvedDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[PluginLoader] Failed to read ${PLUGIN_LOCK_FILE}: ${message}`,
      );
      this.failedPlugins.push({ file: PLUGIN_LOCK_FILE, error: message });
      return [];
    }

    for (const file of files) {
      if (!isValidPluginFile(file)) continue;

      const filePath = join(resolvedDir, file);
      let resolvedPath: string;
      try {
        resolvedPath = await realpath(filePath);
      } catch {
        console.warn(
          `[PluginLoader] Cannot resolve real path for plugin: ${file}`,
        );
        continue;
      }

      const rel = relative(resolvedDir, resolvedPath);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        console.warn(
          `[PluginLoader] Plugin path escapes plugin directory: ${file}`,
        );
        continue;
      }

      const hash = await computeSha256(resolvedPath);
      if (!hash) {
        const error = "Cannot read plugin file for SHA-256 verification";
        console.error(`[PluginLoader] ${error}: ${file}`);
        this.failedPlugins.push({ file, error });
        continue;
      }

      const expectedHash = pluginLock?.plugins[file];
      if (!expectedHash) {
        const error = `${PLUGIN_LOCK_FILE} does not list plugin`;
        console.error(`[PluginLoader] ${error}: ${file} sha256=${hash}`);
        this.failedPlugins.push({ file, error });
        continue;
      }
      if (expectedHash !== hash) {
        const error = `${PLUGIN_LOCK_FILE} hash mismatch`;
        console.error(
          `[PluginLoader] ${error}: ${file} expected=${expectedHash} actual=${hash}`,
        );
        this.failedPlugins.push({ file, error });
        continue;
      }

      const outcome = await loadPluginFromSpecifier(resolvedPath);
      if (outcome.kind === "ok") {
        console.info(
          `[PluginLoader] Loaded plugin "${outcome.provider.name}" path=${resolvedPath} sha256=${hash}`,
        );
        plugins.push(outcome.provider);
      } else if (outcome.kind === "skipped") {
        console.warn(
          `[PluginLoader] ${outcome.reason} in: ${file} sha256=${hash}`,
        );
      } else {
        console.error(
          `[PluginLoader] Failed to load plugin ${file} sha256=${hash}: ${outcome.error}`,
        );
        this.failedPlugins.push({ file, error: outcome.error });
      }
    }

    if (this.failedPlugins.length > 0) {
      console.warn(
        `[PluginLoader] ${this.failedPlugins.length} plugin(s) failed to load:`,
        this.failedPlugins.map((p) => p.file).join(", "),
      );
    }

    return plugins;
  }
}
