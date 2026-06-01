// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFormAccessControl } from "./use-form-access-control";

type UpdatePasswordProtectionParams = {
  enabled: boolean;
  password?: string;
  password_hint?: string;
};

type MutationOptions = {
  mutationFn: (params: UpdatePasswordProtectionParams) => unknown;
  onSuccess?: () => Promise<void> | void;
};

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: null as MutationOptions | null,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: MutationOptions) => {
    mocks.mutationOptions = options;
    return {
      isPending: false,
      mutate: vi.fn(),
    };
  },
  useQuery: () => ({
    data: {
      structure: {
        access_control: {
          password_protection: {
            enabled: false,
            has_password: false,
          },
        },
      },
    },
    isLoading: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          structure: {
            $get: vi.fn(),
            "access-control": {
              $patch: vi.fn(),
            },
          },
        },
      },
    },
  },
  rpc: vi.fn((value: unknown) => value),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { passwordProtection } = useFormAccessControl("form-1");
  return (
    <div>
      {passwordProtection.enabled ? "enabled" : "disabled"}-
      {passwordProtection.hasPassword ? "has-password" : "no-password"}
    </div>
  );
}

function renderProbe(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  return root;
}

describe("useFormAccessControl", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.mutationOptions = null;
  });

  it("invalidates access control, structure-derived diff, and unpublished-change caches after password update", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    expect(container.textContent).toContain("disabled-no-password");
    expect(mocks.mutationOptions?.onSuccess).toBeDefined();

    await act(async () => {
      await mocks.mutationOptions?.onSuccess?.();
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formStructure", "accessControl", "form-1"],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formStructure", "logic", "form-1"],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formDiff", "form-1"],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["unpublishedChanges", "form-1"],
    });

    act(() => {
      root.unmount();
    });
  });
});
