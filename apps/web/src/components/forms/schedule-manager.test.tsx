// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleManager } from "./schedule-manager";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  schedulesRefetch: vi.fn(),
  snapshotsRefetch: vi.fn(),
  schedulesQuery: {
    data: undefined as { schedules: [] } | undefined,
    error: null as Error | null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  snapshotsQuery: {
    data: { snapshots: [] },
    error: null as Error | null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
}));

function renderManager(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<ScheduleManager formId="form-1" />);
  });
  return root;
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mocks.schedulesQuery,
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@/hooks/forms/use-snapshots", () => ({
  useSnapshots: () => ({
    snapshotsQuery: mocks.snapshotsQuery,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/form", () => ({
  Form: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormControl: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormField: () => null,
  FormItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  FormMessage: () => null,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => <span />,
}));

vi.mock("@/lib/api", () => ({
  client: {},
  rpc: vi.fn(),
}));

describe("ScheduleManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.schedulesQuery = {
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      refetch: mocks.schedulesRefetch,
    };
    mocks.snapshotsQuery = {
      data: { snapshots: [] },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mocks.snapshotsRefetch,
    };
  });

  it("shows a retryable schedules error instead of the empty state", () => {
    mocks.schedulesQuery = {
      ...mocks.schedulesQuery,
      error: new Error("スケジュールを読み込めませんでした。"),
      isError: true,
    };
    const container = document.createElement("div");
    const root = renderManager(container);

    expect(container.textContent).toContain(
      "スケジュールを読み込めませんでした。",
    );
    expect(container.textContent).not.toContain(
      "スケジュールが設定されていません。",
    );

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "再読み込み",
    );
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.schedulesRefetch).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("shows a retryable snapshots error", () => {
    mocks.snapshotsQuery = {
      ...mocks.snapshotsQuery,
      error: new Error("スナップショットを読み込めませんでした。"),
      isError: true,
    };
    const container = document.createElement("div");
    const root = renderManager(container);

    expect(container.textContent).toContain(
      "スナップショットを読み込めませんでした。",
    );

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "再読み込み",
    );
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.snapshotsRefetch).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });
});
