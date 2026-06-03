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

type StructureQueryData = {
  structure: {
    access_control: {
      password_protection: {
        enabled: boolean;
        has_password: boolean;
        password_hint?: string;
      };
    };
  };
  password_protection_publication?: {
    current: {
      enabled: boolean;
      has_password: boolean;
      password_hint?: string;
    };
    published: {
      enabled: boolean;
      has_password: boolean;
      password_hint?: string;
    } | null;
    is_synced: boolean;
  };
};

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  mutationOptions: null as MutationOptions | null,
  queryData: null as StructureQueryData | null,
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: MutationOptions) => {
    mocks.mutationOptions = options;
    return {
      isPending: false,
      mutate: mocks.mutate,
      mutateAsync: mocks.mutateAsync,
    };
  },
  useQuery: () => ({
    data: mocks.queryData,
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

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let lastHookResult: ReturnType<typeof useFormAccessControl> | null = null;

function createDefaultQueryData(): StructureQueryData {
  return {
    structure: {
      access_control: {
        password_protection: {
          enabled: false,
          has_password: false,
        },
      },
    },
    password_protection_publication: {
      current: {
        enabled: true,
        has_password: true,
        password_hint: "new hint",
      },
      published: {
        enabled: false,
        has_password: true,
        password_hint: "old hint",
      },
      is_synced: false,
    },
  };
}

function Probe() {
  lastHookResult = useFormAccessControl("form-1");
  const { passwordProtection, passwordProtectionPublication } = lastHookResult;
  return (
    <div>
      {passwordProtection.enabled ? "enabled" : "disabled"}-
      {passwordProtection.hasPassword ? "has-password" : "no-password"}
      {passwordProtectionPublication.isSynced ? "-synced" : "-unsynced"}
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
    mocks.mutate.mockReset();
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockResolvedValue(undefined);
    mocks.queryData = createDefaultQueryData();
    mocks.toastError.mockReset();
    mocks.mutationOptions = null;
    lastHookResult = null;
  });

  it("invalidates access control, structure-derived diff, and unpublished-change caches after password update", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    expect(container.textContent).toContain("disabled-no-password");
    expect(container.textContent).toContain("unsynced");
    expect(lastHookResult?.passwordProtectionPublication).toEqual({
      current: {
        enabled: true,
        hasPassword: true,
        password_hint: "new hint",
      },
      published: {
        enabled: false,
        hasPassword: true,
        password_hint: "old hint",
      },
      isSynced: false,
    });
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

  it("falls back to current form password protection when publication state is absent", () => {
    mocks.queryData = {
      structure: {
        access_control: {
          password_protection: {
            enabled: true,
            has_password: true,
            password_hint: "draft hint",
          },
        },
      },
    };
    const container = document.createElement("div");
    const root = renderProbe(container);

    expect(container.textContent).toContain("enabled-has-password");
    expect(container.textContent).toContain("synced");
    expect(lastHookResult?.passwordProtectionPublication).toEqual({
      current: {
        enabled: true,
        hasPassword: true,
        password_hint: "draft hint",
      },
      published: null,
      isSynced: true,
    });

    act(() => {
      root.unmount();
    });
  });

  it("shows a fallback toast when password update caller omits onError", () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    act(() => {
      lastHookResult?.updatePasswordProtection.mutate({ enabled: false });
    });

    const [, options] = mocks.mutate.mock.calls[0] as [
      UpdatePasswordProtectionParams,
      {
        onError?: (
          error: unknown,
          variables: UpdatePasswordProtectionParams,
          onMutateResult: unknown,
          context: unknown,
        ) => void;
      },
    ];

    act(() => {
      options.onError?.(
        new Error("パスワード保護を更新できませんでした"),
        { enabled: false },
        undefined,
        undefined,
      );
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "パスワード保護を更新できませんでした",
    );

    act(() => {
      root.unmount();
    });
  });

  it("lets caller onError handle feedback without a duplicate fallback toast", () => {
    const container = document.createElement("div");
    const root = renderProbe(container);
    const callerOnError = vi.fn();

    act(() => {
      lastHookResult?.updatePasswordProtection.mutate(
        { enabled: false },
        { onError: callerOnError },
      );
    });

    const [, options] = mocks.mutate.mock.calls[0] as [
      UpdatePasswordProtectionParams,
      {
        onError?: (
          error: Error,
          variables: UpdatePasswordProtectionParams,
          onMutateResult: unknown,
          context: unknown,
        ) => void;
      },
    ];
    const error = new Error("パスワード保護を更新できませんでした");

    act(() => {
      options.onError?.(error, { enabled: false }, undefined, undefined);
    });

    expect(callerOnError).toHaveBeenCalledWith(
      error,
      { enabled: false },
      undefined,
      undefined,
    );
    expect(mocks.toastError).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("shows a fallback toast when async password update caller omits onError", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    await act(async () => {
      await lastHookResult?.updatePasswordProtection.mutateAsync({
        enabled: false,
      });
    });

    const [, options] = mocks.mutateAsync.mock.calls[0] as [
      UpdatePasswordProtectionParams,
      {
        onError?: (
          error: unknown,
          variables: UpdatePasswordProtectionParams,
          onMutateResult: unknown,
          context: unknown,
        ) => void;
      },
    ];

    act(() => {
      options.onError?.(
        new Error("パスワード保護を更新できませんでした"),
        { enabled: false },
        undefined,
        undefined,
      );
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "パスワード保護を更新できませんでした",
    );

    act(() => {
      root.unmount();
    });
  });
});
