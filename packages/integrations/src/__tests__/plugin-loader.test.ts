import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginLoader } from "../plugin-loader";

const VALID_RULE = `
    name: "default",
    label: "Default Rule",
    description: "Default rule",
    inputHint: "Enter a value",
    inputSchema: { parse: (v) => v },
    configSchema: { parse: (v) => v },
    metadataSchema: { parse: (v) => v, safeParse: (v) => ({ success: true, data: v }) },
    validate: async () => ({ isValid: true }),
`;

// No external imports — uses plain objects so dynamic import works from a temp dir
const VALID_PLUGIN_CODE = `
export default {
  name: "test_provider",
  label: "Test Provider",
  description: "A test provider",
  rules: {
    default: {
${VALID_RULE}
    },
  },
};
`;

// Missing required description field
const MISSING_DESCRIPTION_PLUGIN = `
export default {
  name: "bad_provider",
  label: "Bad Provider",
  rules: {
    default: {
${VALID_RULE}
    },
  },
};
`;

const LONG_NAME_PLUGIN = `
export default {
  name: "${"a".repeat(65)}",
  label: "Long Name Provider",
  description: "A test provider",
  rules: {
    default: {
${VALID_RULE}
    },
  },
};
`;

const INVALID_FORMAT_NAME_PLUGIN = `
export default {
  name: "Bad-Format",
  label: "Bad Format Provider",
  description: "A test provider",
  rules: {
    default: {
${VALID_RULE}
    },
  },
};
`;

const NO_RULES_PLUGIN = `
export default {
  name: "no_rules_provider",
  label: "No Rules",
  description: "Provider without rules",
  rules: {},
};
`;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `plugin-loader-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("PluginLoader", () => {
  it("returns empty array when directory does not exist", async () => {
    const loader = new PluginLoader(join(tmpDir, "nonexistent"));
    const plugins = await loader.loadPlugins();
    expect(plugins).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toEqual([]);
  });

  it("skips hidden files (dot-prefixed)", async () => {
    await writeFile(join(tmpDir, ".hidden.js"), VALID_PLUGIN_CODE);
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toEqual([]);
  });

  it("skips files with unknown extensions", async () => {
    await writeFile(join(tmpDir, "plugin.txt"), VALID_PLUGIN_CODE);
    await writeFile(join(tmpDir, "plugin.json"), "{}");
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toEqual([]);
  });

  it("records failed plugins and reports them", async () => {
    await writeFile(join(tmpDir, "broken.js"), "this is not valid js }{{{");
    const loader = new PluginLoader(tmpDir);
    await loader.loadPlugins();
    expect(loader.hasFailedPlugins()).toBe(true);
    expect(loader.getFailedPlugins()[0]?.file).toBe("broken.js");
  });

  it("loads a valid plugin from a .mjs file", async () => {
    await writeFile(join(tmpDir, "valid.mjs"), VALID_PLUGIN_CODE);
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("test_provider");
    expect(plugins[0]?.label).toBe("Test Provider");
    expect(plugins[0]?.description).toBe("A test provider");
    expect(plugins[0]?.rules.default?.name).toBe("default");
  });

  it("skips plugin with missing description", async () => {
    await writeFile(join(tmpDir, "bad.mjs"), MISSING_DESCRIPTION_PLUGIN);
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toHaveLength(0);
  });

  it("skips plugin with no rules", async () => {
    await writeFile(join(tmpDir, "norules.mjs"), NO_RULES_PLUGIN);
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toHaveLength(0);
  });

  it("hasFailedPlugins returns false when nothing failed", async () => {
    const loader = new PluginLoader(tmpDir);
    await loader.loadPlugins();
    expect(loader.hasFailedPlugins()).toBe(false);
  });

  it("getFailedPlugins returns a copy, not the internal array", async () => {
    const loader = new PluginLoader(tmpDir);
    await loader.loadPlugins();
    const copy = loader.getFailedPlugins();
    copy.push({ file: "fake.js", error: "fake" });
    expect(loader.getFailedPlugins()).toHaveLength(0);
  });

  it("skips plugin with a name longer than 64 characters", async () => {
    await writeFile(join(tmpDir, "long.mjs"), LONG_NAME_PLUGIN);
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toHaveLength(0);
  });

  it("skips plugin with an invalid name format", async () => {
    await writeFile(join(tmpDir, "badfmt.mjs"), INVALID_FORMAT_NAME_PLUGIN);
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toHaveLength(0);
  });

  it("accepts plugin with exactly 64 characters name", async () => {
    const code = `
export default {
  name: "${"a".repeat(64)}",
  label: "Max Length Provider",
  description: "A test provider",
  rules: {
    default: {
${VALID_RULE}
    },
  },
};
`;
    await writeFile(join(tmpDir, "maxlen.mjs"), code);
    const loader = new PluginLoader(tmpDir);
    const plugins = await loader.loadPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("a".repeat(64));
  });
});
