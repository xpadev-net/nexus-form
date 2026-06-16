// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFormPublishActions } from "./use-form-publish-actions";

type MutationOptions = {
  mutationFn?: (variables: unknown) => Promise<unknown> | unknown;
  onError?: (error: unknown) => void;
  onSuccess?: () => Promise<void> | void;
};

type MutationHandler = (variables: unknown) => Promise<unknown> | unknown;

type MutationDescriptor = {
  name: string;
  options: MutationOptions;
};

type MutationOverride = {
  handler: MutationHandler;
  matches: (mutation: MutationDescriptor) => boolean;
};

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: [] as MutationOptions[],
  mutationOverrides: [] as MutationOverride[],
  mutationRecords: [] as MutationDescriptor[],
  publishSnapshotMutateAsync: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: MutationOptions) => {
    const name =
      options.mutationFn?.name ?? `mutation-${mocks.mutationOptions.length}`;
    const mutation = { name, options };
    mocks.mutationOptions.push(options);
    mocks.mutationRecords.push(mutation);
    return {
      isPending: false,
      mutateAsync: vi.fn(async (variables: unknown) => {
        const handler = mocks.mutationOverrides.find(({ matches }) =>
          matches(mutation),
        )?.handler;
        const result = handler
          ? await handler(variables)
          : await options.mutationFn?.(variables);
        await options.onSuccess?.();
        return result;
      }),
    };
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("./use-form-diff", () => ({
  useFormDiff: () => ({
    hasChangesFromActive: false,
    hasUnpublishedChanges: false,
    totalChanges: 0,
  }),
}));

vi.mock("./use-snapshot-publish", () => ({
  useSnapshotPublish: () => ({
    activeSnapshotVersion: 1,
    isPublishing: false,
    isResetting: false,
    lastPublishedVersion: 1,
    latestSnapshotQuery: {
      data: { hasActiveSnapshot: true },
    },
    publishSnapshotMutation: {
      mutateAsync: mocks.publishSnapshotMutateAsync,
    },
    resetToSnapshotMutation: {
      mutateAsync: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          publish: {
            $post: vi.fn(),
          },
          snapshots: {
            ":version": {
              activate: {
                $post: vi.fn(),
              },
            },
          },
          unpublish: {
            $post: vi.fn(),
          },
        },
      },
    },
  },
  rpc: vi.fn((value: unknown) => value),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let latestActions: ReturnType<typeof useFormPublishActions> | null = null;

function Probe() {
  latestActions = useFormPublishActions("form-1");
  return null;
}

function renderProbe(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  return root;
}

function silentMutationNamed(name: string) {
  return (mutation: MutationDescriptor) =>
    mutation.name === name && mutation.options.onError === undefined;
}

function mutationOption(
  matches: (mutation: MutationDescriptor) => boolean,
): MutationOptions {
  const mutation = mocks.mutationRecords.find(matches);
  if (!mutation) {
    throw new Error("expected mutation was not registered");
  }
  return mutation.options;
}

describe("useFormPublishActions", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.mutationOptions = [];
    mocks.mutationOverrides = [];
    mocks.mutationRecords = [];
    mocks.publishSnapshotMutateAsync.mockReset();
    latestActions = null;
  });

  it("refreshes access-control publication state after activating a snapshot", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    await act(async () => {
      await mutationOption(
        (mutation) =>
          mutation.name === "activateSnapshot" &&
          mutation.options.onError !== undefined,
      ).onSuccess?.();
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formStructure", "accessControl", "form-1"],
    });

    act(() => {
      root.unmount();
    });
  });

  it("keeps the saved snapshot version and manual recovery step in publish partial failures", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    mocks.publishSnapshotMutateAsync.mockResolvedValue({ version: 7 });
    const activateMutation = vi.fn().mockResolvedValue(undefined);
    const publishMutation = vi
      .fn()
      .mockRejectedValue(new Error("公開 API が失敗しました"));
    mocks.mutationOverrides.push(
      {
        handler: activateMutation,
        matches: silentMutationNamed("activateSnapshot"),
      },
      {
        handler: publishMutation,
        matches: silentMutationNamed("publishCurrentForm"),
      },
    );

    if (latestActions === null) {
      throw new Error("publish actions were not rendered");
    }

    await expect(latestActions.saveAndPublish("release")).rejects.toThrow(
      "スナップショット(v7)は公開版に設定されましたが、フォームの公開に失敗しました。公開メニューから手動でフォームを公開してください。",
    );
    expect(mocks.publishSnapshotMutateAsync).toHaveBeenCalledWith({
      changeLog: "release",
    });
    expect(
      mutationOption(silentMutationNamed("activateSnapshot")).onError,
    ).toBeUndefined();
    expect(
      mutationOption(silentMutationNamed("publishCurrentForm")).onError,
    ).toBeUndefined();
    expect(activateMutation).toHaveBeenCalledWith(7);
    expect(publishMutation).toHaveBeenCalledWith(undefined);
    expect(activateMutation.mock.invocationCallOrder[0]).toBeLessThan(
      publishMutation.mock.invocationCallOrder[0] ?? 0,
    );

    act(() => {
      root.unmount();
    });
  });

  it("keeps the saved snapshot version and manual recovery step in activate partial failures", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    mocks.publishSnapshotMutateAsync.mockResolvedValue({ version: 8 });
    const activateMutation = vi
      .fn()
      .mockRejectedValue(new Error("activate API が失敗しました"));
    mocks.mutationOverrides.push({
      handler: activateMutation,
      matches: silentMutationNamed("activateSnapshot"),
    });

    if (latestActions === null) {
      throw new Error("publish actions were not rendered");
    }

    await expect(latestActions.saveAndActivate("activate")).rejects.toThrow(
      "スナップショット(v8)は保存されましたが、公開版の更新に失敗しました。バージョン履歴から手動で公開版を選択してください。",
    );
    expect(mocks.publishSnapshotMutateAsync).toHaveBeenCalledWith({
      changeLog: "activate",
    });
    expect(
      mutationOption(silentMutationNamed("activateSnapshot")).onError,
    ).toBeUndefined();
    expect(activateMutation).toHaveBeenCalledWith(8);

    act(() => {
      root.unmount();
    });
  });
});
