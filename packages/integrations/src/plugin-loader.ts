/**
 * Validation Provider Plugin Loader
 *
 * ファイルシステムからPluginを読み込む
 */

import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { ValidationProvider } from "./plugin-interface";

const VALID_PLUGIN_EXTENSIONS = [".js", ".mjs"];
const PLUGIN_LOCK_FILE = "plugins.lock";
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pluginLockFilenameSchema = z
  .string()
  .regex(/^[^.][^/\\]*\.(?:js|mjs)$/)
  .refine((value) => value === value.trim());
const pluginLockSchema = z
  .object({
    plugins: z.record(pluginLockFilenameSchema, sha256Schema),
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

type VerifiedPluginSource = {
  hash: string;
  source: string;
};

function resolveReadablePluginPath(path: string): string {
  return path.startsWith("file://") ? fileURLToPath(path) : path;
}

function versionedFileSpecifier(path: string, hash: string): string {
  const url = pathToFileURL(resolveReadablePluginPath(path));
  url.searchParams.set("sha256", hash);
  return url.href;
}

async function readPluginSource(
  path: string,
): Promise<VerifiedPluginSource | null> {
  try {
    const readablePath = resolveReadablePluginPath(path);
    const buf = await readFile(readablePath);
    return {
      hash: createHash("sha256").update(buf).digest("hex"),
      source: buf.toString("utf8"),
    };
  } catch {
    return null;
  }
}

export type PluginLoadOutcome =
  | { kind: "ok"; provider: ValidationProvider }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string };

/**
 * Result of hashing and loading a plugin file from a stable file snapshot.
 *
 * `kind: "ok"` includes the loaded provider and a guaranteed SHA-256 `hash`.
 * `kind: "skipped"` includes a validation `reason` and a guaranteed `hash`
 * because the file was readable but did not export a valid provider.
 * `kind: "failed"` includes an `error`; `hash` is present only when the file
 * was readable and loading failed after hashing.
 */
export type HashedPluginLoadOutcome =
  | { kind: "ok"; provider: ValidationProvider; hash: string }
  | { kind: "skipped"; reason: string; hash: string }
  | { kind: "failed"; error: string; hash?: string };

export async function loadPluginFromSpecifier(
  specifier: string,
): Promise<PluginLoadOutcome> {
  return loadPluginModule(specifier);
}

/**
 * Loads a plugin from a filesystem path or `file://` URL by hashing the file,
 * importing it through a cache-busted file URL, then verifying the hash is
 * unchanged. Returns `kind: "ok"` with `provider` and `hash` for valid
 * providers, `kind: "skipped"` with `reason` and `hash` for readable files
 * that do not expose a valid provider, and `kind: "failed"` with `error` when
 * reading, importing, or stability verification fails. Failed results include
 * `hash` only when the file was read.
 */
export async function loadPluginFromFile(
  path: string,
): Promise<HashedPluginLoadOutcome> {
  const verifiedSource = await readPluginSource(path);
  if (!verifiedSource) {
    return {
      kind: "failed",
      error: "Cannot read plugin file for SHA-256 calculation",
    };
  }

  const outcome = await loadPluginModule(
    versionedFileSpecifier(path, verifiedSource.hash),
  );
  const loadedSource = await readPluginSource(path);
  if (!loadedSource) {
    return {
      kind: "failed",
      error: "Cannot read plugin file after loading",
      hash: verifiedSource.hash,
    };
  }
  if (loadedSource.hash !== verifiedSource.hash) {
    return {
      kind: "failed",
      error: "Plugin file changed during load",
      hash: verifiedSource.hash,
    };
  }

  if (outcome.kind === "ok") {
    return {
      kind: "ok",
      provider: outcome.provider,
      hash: verifiedSource.hash,
    };
  }
  if (outcome.kind === "skipped") {
    return {
      kind: "skipped",
      reason: outcome.reason,
      hash: verifiedSource.hash,
    };
  }
  return { kind: "failed", error: outcome.error, hash: verifiedSource.hash };
}

async function loadPluginFromVerifiedSource(
  source: string,
  sourcePath: string,
): Promise<PluginLoadOutcome> {
  const sourceUrl = pathToFileURL(sourcePath).href;
  const sourceWithUrl = `${source}\n//# sourceURL=${sourceUrl}`;
  const specifier = `data:text/javascript;base64,${Buffer.from(sourceWithUrl).toString("base64")}`;
  return loadPluginModule(specifier);
}

async function loadPluginModule(specifier: string): Promise<PluginLoadOutcome> {
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
  private loadedPluginHashes: string[] = [];

  constructor(pluginsDir: string) {
    this.pluginsDir = pluginsDir;
  }

  getFailedPlugins(): Array<{ file: string; error: string }> {
    return [...this.failedPlugins];
  }

  hasFailedPlugins(): boolean {
    return this.failedPlugins.length > 0;
  }

  /**
   * Returns SHA-256 hashes for plugins successfully loaded by the most recent
   * `loadPlugins()` call. The returned array is a copy and includes only
   * `kind: "ok"` plugin files that passed lockfile verification.
   */
  getLoadedPluginHashes(): string[] {
    return [...this.loadedPluginHashes];
  }

  async loadPlugins(): Promise<ValidationProvider[]> {
    this.loadedPluginHashes = [];
    this.failedPlugins = [];
    let resolvedDir: string;
    try {
      resolvedDir = await realpath(this.pluginsDir);
      const dirStat = await stat(resolvedDir);
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

      const verifiedSource = await readPluginSource(resolvedPath);
      if (!verifiedSource) {
        const error = "Cannot read plugin file for SHA-256 verification";
        console.error(`[PluginLoader] ${error}: ${file}`);
        this.failedPlugins.push({ file, error });
        continue;
      }

      const expectedHash =
        pluginLock === null ? undefined : pluginLock.plugins[file];
      if (pluginLock === null || expectedHash === undefined) {
        const error =
          pluginLock === null
            ? `${PLUGIN_LOCK_FILE} not found`
            : `${PLUGIN_LOCK_FILE} does not list plugin`;
        console.error(
          `[PluginLoader] ${error}: ${file} sha256=${verifiedSource.hash}`,
        );
        this.failedPlugins.push({ file, error });
        continue;
      }
      if (expectedHash !== verifiedSource.hash) {
        const error = `${PLUGIN_LOCK_FILE} hash mismatch`;
        console.error(
          `[PluginLoader] ${error}: ${file} expected=${expectedHash} actual=${verifiedSource.hash}`,
        );
        this.failedPlugins.push({ file, error });
        continue;
      }

      const outcome = await loadPluginFromVerifiedSource(
        verifiedSource.source,
        resolvedPath,
      );
      if (outcome.kind === "ok") {
        console.info(
          `[PluginLoader] Loaded plugin "${outcome.provider.name}" path=${resolvedPath} sha256=${verifiedSource.hash}`,
        );
        this.loadedPluginHashes.push(verifiedSource.hash);
        plugins.push(outcome.provider);
      } else if (outcome.kind === "skipped") {
        console.warn(
          `[PluginLoader] ${outcome.reason} in: ${file} sha256=${verifiedSource.hash}`,
        );
      } else {
        console.error(
          `[PluginLoader] Failed to load plugin ${file} sha256=${verifiedSource.hash}: ${outcome.error}`,
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
