// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFormPublishActions } from "./use-form-publish-actions";

type MutationOptions = {
  onSuccess?: () => Promise<void> | void;
};

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: [] as MutationOptions[],
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: MutationOptions) => {
    mocks.mutationOptions.push(options);
    return {
      isPending: false,
      mutateAsync: vi.fn(),
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
      mutateAsync: vi.fn(),
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

function Probe() {
  useFormPublishActions("form-1");
  return null;
}

function renderProbe(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  return root;
}

describe("useFormPublishActions", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.mutationOptions = [];
  });

  it("refreshes access-control publication state after activating a snapshot", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    await act(async () => {
      await mocks.mutationOptions[0]?.onSuccess?.();
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formStructure", "accessControl", "form-1"],
    });

    act(() => {
      root.unmount();
    });
  });
});
