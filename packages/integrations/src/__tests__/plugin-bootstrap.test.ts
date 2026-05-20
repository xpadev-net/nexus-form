import { describe, expect, it } from "vitest";
import {
  BUILTIN_VALIDATION_PLUGIN_SPECIFIERS,
  DEFAULT_VALIDATION_PLUGINS_DIR,
  getValidationPluginsDir,
} from "../plugin-bootstrap";

describe("plugin bootstrap constants", () => {
  it("defines built-in validation plugins in one shared order", () => {
    expect(BUILTIN_VALIDATION_PLUGIN_SPECIFIERS).toEqual([
      "@nexus-form/validation-provider-discord/plugin",
      "@nexus-form/validation-provider-github/plugin",
      "@nexus-form/validation-provider-twitter/plugin",
    ]);
  });

  it("uses the default validation plugin directory unless overridden", () => {
    expect(getValidationPluginsDir({})).toBe(DEFAULT_VALIDATION_PLUGINS_DIR);
    expect(
      getValidationPluginsDir({
        VALIDATION_PLUGINS_DIR: "/custom/plugins",
      }),
    ).toBe("/custom/plugins");
  });
});
