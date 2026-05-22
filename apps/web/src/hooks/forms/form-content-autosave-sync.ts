export type ServerContentSyncInput = {
  hasLocalEdits: boolean;
  serverVersion: number;
  serverCanonical: string;
  versionRef: number;
  baseContentRef: string;
};

export type ServerContentSyncResult =
  | { action: "apply-server"; version: number; canonical: string }
  | { action: "stash-remote"; remoteCanonical: string; remoteVersion: number }
  | { action: "noop" };

/** R12-P6: decide whether incoming server content may advance autosave version refs. */
export function resolveServerContentSync(
  input: ServerContentSyncInput,
): ServerContentSyncResult {
  if (input.hasLocalEdits) {
    if (
      input.serverVersion !== input.versionRef ||
      input.serverCanonical !== input.baseContentRef
    ) {
      return {
        action: "stash-remote",
        remoteCanonical: input.serverCanonical,
        remoteVersion: input.serverVersion,
      };
    }
    return { action: "noop" };
  }

  return {
    action: "apply-server",
    version: input.serverVersion,
    canonical: input.serverCanonical,
  };
}
