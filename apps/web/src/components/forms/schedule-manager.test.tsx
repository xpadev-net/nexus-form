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
    data: undefined as { schedules: ScheduleFixture[] } | undefined,
    error: null as Error | null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  snapshotsQuery: {
    data: { snapshots: [] as SnapshotFixture[] },
    error: null as Error | null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
}));

type ScheduleFixture = {
  id: string;
  formId: string;
  triggerAt: string;
  action: "PUBLISH" | "UNPUBLISH" | "SWITCH_SNAPSHOT";
  snapshotVersion: number | null;
  processedAt: string | null;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
};

type SnapshotFixture = {
  id: string;
  formId: string;
  version: number;
  isActive: boolean;
  publishedBy: string | null;
  publishedAt: string;
  changeLog?: string | null;
  title: string;
  description?: string | null;
  parentVersion?: number | null;
};

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
    warning: vi.fn(),
  },
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
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

    const retryButton = container.querySelector(
      'button[data-testid="schedule-query-retry"]',
    );
    expect(retryButton).not.toBeNull();

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

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "追加",
    );
    expect(addButton).not.toBeNull();
    expect(addButton?.disabled).toBe(true);

    const retryButton = container.querySelector(
      'button[data-testid="schedule-snapshots-query-retry"]',
    );
    expect(retryButton).not.toBeNull();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.snapshotsRefetch).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("shows a save summary before creating a schedule", () => {
    const container = document.createElement("div");
    const root = renderManager(container);

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "追加",
    );
    expect(addButton).not.toBeNull();

    act(() => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("保存前の確認");
    expect(container.textContent).toContain(
      "日時未設定 にフォームを 公開 状態へ切り替えます。",
    );

    act(() => root.unmount());
  });

  it("labels pending, completed, failed, and cancelled schedules with recovery actions", () => {
    const timestamp = "2026-06-01T00:00:00.000Z";
    mocks.snapshotsQuery = {
      ...mocks.snapshotsQuery,
      data: {
        snapshots: [
          {
            id: "snapshot-1",
            formId: "form-1",
            version: 1,
            isActive: true,
            publishedBy: null,
            publishedAt: timestamp,
            changeLog: null,
            title: "v1",
            description: null,
            parentVersion: null,
          },
        ],
      },
    };
    mocks.schedulesQuery = {
      ...mocks.schedulesQuery,
      data: {
        schedules: [
          {
            id: "pending-schedule",
            formId: "form-1",
            triggerAt: timestamp,
            action: "PUBLISH",
            snapshotVersion: null,
            processedAt: null,
            status: "PENDING",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          {
            id: "completed-schedule",
            formId: "form-1",
            triggerAt: timestamp,
            action: "UNPUBLISH",
            snapshotVersion: null,
            processedAt: timestamp,
            status: "COMPLETED",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          {
            id: "failed-schedule",
            formId: "form-1",
            triggerAt: timestamp,
            action: "SWITCH_SNAPSHOT",
            snapshotVersion: 3,
            processedAt: timestamp,
            status: "COMPLETED",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          {
            id: "cancelled-schedule",
            formId: "form-1",
            triggerAt: timestamp,
            action: "PUBLISH",
            snapshotVersion: null,
            processedAt: new Date(
              new Date(timestamp).getTime() - 1000,
            ).toISOString(),
            status: "CANCELLED",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      },
    };
    const container = document.createElement("div");
    const root = renderManager(container);

    expect(container.textContent).toContain("未実行");
    expect(container.textContent).toContain("実行済み");
    expect(container.textContent).toContain("失敗");
    expect(container.textContent).toContain("取消済み");
    expect(container.textContent).toContain(
      "切り替え先のスナップショットを確認できません。再実行するか、管理ログで詳細を確認してください。",
    );
    expect(
      container.querySelector('button[aria-label="再実行"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="ログ確認"]'),
    ).not.toBeNull();

    act(() => {
      container
        .querySelector('button[aria-label="再実行"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("スケジュールを再実行");
    expect(container.textContent).toContain("公開版を 未選択 へ切り替えます。");

    act(() => root.unmount());
  });
});
