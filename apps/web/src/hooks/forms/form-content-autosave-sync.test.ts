import { describe, expect, it } from "vitest";
import { resolveServerContentSync } from "./form-content-autosave-sync";

describe("resolveServerContentSync (R12-P6)", () => {
  it("stashes remote content instead of advancing refs while local edits are pending", () => {
    const result = resolveServerContentSync({
      hasLocalEdits: true,
      serverVersion: 8,
      serverCanonical: "remote",
      versionRef: 7,
      baseContentRef: "base",
    });

    expect(result).toEqual({
      action: "stash-remote",
      remoteCanonical: "remote",
      remoteVersion: 8,
    });
  });

  it("applies server content when there are no local edits", () => {
    const result = resolveServerContentSync({
      hasLocalEdits: false,
      serverVersion: 8,
      serverCanonical: "remote",
      versionRef: 7,
      baseContentRef: "base",
    });

    expect(result).toEqual({
      action: "apply-server",
      version: 8,
      canonical: "remote",
    });
  });
});
