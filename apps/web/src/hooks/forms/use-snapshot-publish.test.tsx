// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSnapshotPublish } from "./use-snapshot-publish";

type MutationOptions = {
  onSuccess?: (data: { plateContent: string }) => Promise<void> | void;
};

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: [] as MutationOptions[],
}));

vi.mock("@tanstack/react-query", () => ({
  skipToken: Symbol("skipToken"),
  useMutation: (options: MutationOptions) => {
    mocks.mutationOptions.push(options);
    return {
      isPending: false,
      mutateAsync: vi.fn(),
    };
  },
  useQuery: () => ({
    data: {
      activeSnapshotVersion: 1,
      hasActiveSnapshot: true,
      snapshot: { version: 1 },
    },
  }),
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          snapshots: {
            $post: vi.fn(),
            latest: {
              $get: vi.fn(),
            },
            reset: {
              $post: vi.fn(),
            },
          },
          "unpublished-changes": {
            $get: vi.fn(),
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
  useSnapshotPublish("form-1");
  return null;
}

function renderProbe(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  return root;
}

describe("useSnapshotPublish", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.mutationOptions = [];
  });

  it("refreshes access-control publication state after saving a snapshot", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    await act(async () => {
      await mocks.mutationOptions[0]?.onSuccess?.({ plateContent: "[]" });
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formStructure", "accessControl", "form-1"],
    });

    act(() => {
      root.unmount();
    });
  });

  it("refreshes access-control publication state after resetting to the active snapshot", async () => {
    const container = document.createElement("div");
    const root = renderProbe(container);

    await act(async () => {
      await mocks.mutationOptions[1]?.onSuccess?.({ plateContent: "[]" });
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formStructure", "accessControl", "form-1"],
    });

    act(() => {
      root.unmount();
    });
  });
});
