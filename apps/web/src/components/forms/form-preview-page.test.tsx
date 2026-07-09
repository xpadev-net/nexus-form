// @vitest-environment jsdom

import { fireEvent, getByRole } from "@testing-library/dom";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormAppearance } from "@/types/validation/form";
import type { FormSubmitRequestData } from "./form-body";
import { FormPreviewPage } from "./form-preview-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockAppearance = vi.hoisted(() => ({
  theme: {
    primary_color: "#2563eb",
    accent_color: "#16a34a",
    background_color: "#ffffff",
    font_family: "Inter",
  },
  layout: {
    width: "medium",
    alignment: "center",
    spacing: "comfortable",
    show_progress_bar: true,
    progress_position: "top",
    show_question_numbers: true,
  },
}));
const historicalAppearance = vi.hoisted(() => ({
  theme: {
    primary_color: "#be123c",
    accent_color: "#0f766e",
    background_color: "#fff7ed",
    font_family: "Noto Sans JP",
  },
  layout: {
    width: "full" as const,
    alignment: "left" as const,
    spacing: "compact" as const,
    show_progress_bar: false,
    progress_position: "bottom" as const,
    show_question_numbers: false,
  },
}));
const formBodyProps = vi.hoisted(
  () =>
    [] as Array<{
      appearance?: FormAppearance;
      onSubmitRequest?: (data: FormSubmitRequestData) => void;
      plateContent: string;
      submittedCompletionPageId?: string | null;
    }>,
);
const queryMockState = vi.hoisted(() => ({
  confirmation: undefined as Record<string, unknown> | undefined,
  loadingKeys: [] as string[],
  plateContent: "[]" as string,
  renderSubmitButton: false,
  snapshotContent: null as {
    appearance?: FormAppearance;
    confirmation?: Record<string, unknown>;
    plateContent: string;
    publishedAt: string;
    version: number;
  } | null,
  snapshots: [] as Array<{
    isActive: boolean;
    publishedAt: string;
    version: number;
  }>,
  useActualFormBody: false,
}));
const apiMocks = vi.hoisted(() => ({
  publicSubmitPost: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children: ReactNode;
    params?: Record<string, string>;
    to: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={to
        .replace("$id", params?.id ?? "form-1")
        .replace("$publicId", params?.publicId ?? "public-1")}
      {...props}
    >
      {children}
    </a>
  ),
  useParams: () => ({ id: "form-1" }),
  useSearch: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const key = queryKey[0] ?? "";
    if (queryMockState.loadingKeys.includes(key)) {
      return {
        data: undefined,
        error: null,
        isLoading: true,
      };
    }
    if (queryKey[0] === "formContent") {
      return {
        data: {
          plateContent: queryMockState.plateContent,
          plateContentVersion: 1,
        },
        error: null,
        isLoading: false,
      };
    }
    if (queryKey[0] === "formStructure") {
      return {
        data: {
          structure: {
            appearance: mockAppearance,
            confirmation: queryMockState.confirmation,
          },
        },
        error: null,
        isLoading: false,
      };
    }
    return {
      data: {
        form: {
          description: "Preview description",
          id: "form-1",
          publicId: "public-1",
          status: "DRAFT",
          title: "Preview form",
        },
      },
      error: null,
      isLoading: false,
    };
  },
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      aria-label="プレビューバージョン"
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock("@/components/forms/form-status-badge", () => ({
  FormStatusBadge: () => <span data-testid="status-badge" />,
}));
vi.mock("@/components/editor/plate-viewer", async () => {
  const { useFormResponseOptional } = await vi.importActual<
    typeof import("@/contexts/form-response-context")
  >("@/contexts/form-response-context");

  type PlateNode = {
    blockId?: string;
    children?: PlateNode[];
    text?: string;
    type?: string;
    validation?: {
      options?: Array<{ id: string; label: string }>;
    };
  };

  function textFromNode(node: PlateNode): string {
    if (typeof node.text === "string") return node.text;
    return node.children?.map(textFromNode).join("") ?? "";
  }

  return {
    PlateViewer: ({ value }: { value: string }) => {
      const ctx = useFormResponseOptional();
      let nodes: PlateNode[] = [];
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
          nodes = parsed as PlateNode[];
        }
      } catch {
        nodes = [];
      }

      return (
        <div data-testid="plate-viewer">
          {nodes.map((node, index) => {
            if (node.type === "form_radio" && node.blockId) {
              const answer = ctx?.getAnswer(node.blockId);
              return (
                <fieldset
                  key={node.blockId}
                  data-form-question-id={node.blockId}
                >
                  <legend>{textFromNode(node)}</legend>
                  {node.validation?.options?.map((option) => (
                    <label key={option.id}>
                      <input
                        aria-label={option.label}
                        checked={answer?.value === option.id}
                        name={node.blockId}
                        type="radio"
                        value={option.id}
                        onChange={(event) => {
                          if (event.currentTarget.checked) {
                            ctx?.setAnswer(node.blockId ?? "", {
                              value: option.id,
                            });
                          }
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
              );
            }

            const text = textFromNode(node);
            return text ? <p key={node.blockId ?? index}>{text}</p> : null;
          })}
        </div>
      );
    },
  };
});
vi.mock("@/components/forms/form-body", async () => {
  const actual =
    await vi.importActual<typeof import("./form-body")>("./form-body");
  return {
    FormBody: (props: {
      appearance?: FormAppearance;
      onSubmitRequest?: (data: FormSubmitRequestData) => void;
      plateContent: string;
      submittedCompletionPageId?: string | null;
    }) => {
      formBodyProps.push(props);
      if (queryMockState.useActualFormBody) {
        return (
          <actual.FormBody {...props} mode="preview" title="Preview form" />
        );
      }
      return (
        <main
          data-submitted-completion-page-id={
            props.submittedCompletionPageId ?? undefined
          }
          data-testid="form-body"
        >
          {queryMockState.renderSubmitButton ? (
            <button
              type="button"
              onClick={() =>
                props.onSubmitRequest?.({
                  completionTargetPageId: "section-complete-vip",
                  responses: [
                    {
                      question_id: "q-plan",
                      question_title: "プラン",
                      question_type: "radio",
                      value: "vip",
                    },
                  ],
                  visitedQuestionIds: ["q-plan"],
                })
              }
            >
              preview submit
            </button>
          ) : null}
        </main>
      );
    },
  };
});
vi.mock("@/contexts/form-response-context", async () =>
  vi.importActual("@/contexts/form-response-context"),
);
vi.mock("@/hooks/forms/use-snapshot-content", () => ({
  useSnapshotContent: () => ({
    data: queryMockState.snapshotContent,
    error: null,
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@/hooks/forms/use-snapshots", () => ({
  useSnapshots: () => ({
    snapshotsQuery: {
      data: { snapshots: queryMockState.snapshots },
      error: null,
    },
  }),
}));
vi.mock("@/hooks/use-page-title", () => ({
  usePageTitle: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        public: {
          ":publicId": {
            submit: {
              $post: apiMocks.publicSubmitPost,
            },
          },
        },
      },
    },
  },
  rpc: apiMocks.rpc,
}));

describe("FormPreviewPage links", () => {
  beforeEach(() => {
    formBodyProps.length = 0;
    queryMockState.confirmation = undefined;
    queryMockState.loadingKeys = [];
    queryMockState.plateContent = "[]";
    queryMockState.renderSubmitButton = false;
    queryMockState.snapshotContent = null;
    queryMockState.snapshots = [];
    queryMockState.useActualFormBody = false;
    apiMocks.publicSubmitPost.mockReset();
    apiMocks.rpc.mockReset();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders only the preview loading status while initial queries are pending", () => {
    queryMockState.loadingKeys = ["formContent"];

    const html = renderToStaticMarkup(<FormPreviewPage />);

    expect(html).toContain('data-preview-loading="true"');
    expect(html).toContain("プレビューを準備しています。");
    expect(html).not.toContain("読み込み中...");
    expect(html).not.toContain('data-testid="form-body"');
    expect(formBodyProps).toEqual([]);
  });

  it("renders preview navigation links without nested buttons", () => {
    const html = renderToStaticMarkup(<FormPreviewPage />);

    expect(html).not.toContain('data-preview-loading="true"');
    expect(html).not.toContain("読み込み中...");
    expect(html).not.toContain("<button");
    expect(html).toContain("公開フォーム");
    expect(html).toContain("エディタに戻る");
    expect(html).toContain('href="/forms/public/public-1"');
    expect(html).toContain('href="/forms/form-1/edit"');
    expect(html).toContain('target="_blank"');
  });

  it("passes latest structure appearance to FormBody", () => {
    renderToStaticMarkup(<FormPreviewPage />);

    expect(formBodyProps.at(-1)?.appearance).toEqual(mockAppearance);
  });

  it("wraps the latest preview body in the shared appearance surface", () => {
    const html = renderToStaticMarkup(<FormPreviewPage />);

    expect(html).toContain('data-form-appearance-surface="true"');
    expect(html).toContain("--background:#ffffff");
    expect(html).toContain("--card:#ebebeb");
    expect(html).toContain("--primary:#2563eb");
    expect(html).toContain("--accent:#16a34a");
  });

  it("uses one historical snapshot for content, appearance, and confirmation", async () => {
    const latestPlateContent = JSON.stringify([
      { type: "p", children: [{ text: "最新の編集内容" }] },
    ]);
    const historicalPlateContent = JSON.stringify([
      { type: "p", children: [{ text: "履歴版の内容" }] },
    ]);
    queryMockState.plateContent = latestPlateContent;
    queryMockState.confirmation = {
      title: "最新の確認タイトル",
      message: "最新の確認メッセージ",
    };
    queryMockState.snapshots = [
      {
        version: 2,
        publishedAt: "2026-07-01T00:00:00.000Z",
        isActive: false,
      },
    ];
    queryMockState.snapshotContent = {
      version: 2,
      publishedAt: "2026-07-01T00:00:00.000Z",
      plateContent: historicalPlateContent,
      appearance: historicalAppearance,
      confirmation: {
        title: "履歴版の確認タイトル",
        message: "履歴版の確認メッセージ",
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<FormPreviewPage />);
    });
    await act(async () => {
      fireEvent.change(
        getByRole(container, "combobox", { name: "プレビューバージョン" }),
        { target: { value: "2" } },
      );
    });

    expect(formBodyProps.at(-1)?.plateContent).toBe(historicalPlateContent);
    expect(formBodyProps.at(-1)?.plateContent).not.toBe(latestPlateContent);
    expect(formBodyProps.at(-1)?.appearance).toEqual(historicalAppearance);
    const appearanceSurface = container.querySelector<HTMLElement>(
      "[data-form-appearance-surface]",
    );
    expect(appearanceSurface?.style.getPropertyValue("--primary")).toBe(
      "#be123c",
    );
    expect(appearanceSurface?.style.getPropertyValue("--primary")).not.toBe(
      "#2563eb",
    );

    await act(async () => {
      formBodyProps.at(-1)?.onSubmitRequest?.({
        responses: [],
        visitedQuestionIds: [],
      });
    });

    expect(container.textContent).toContain("履歴版の確認タイトル");
    expect(container.textContent).toContain("履歴版の確認メッセージ");
    expect(container.textContent).not.toContain("最新の確認タイトル");

    await act(async () => {
      root.unmount();
    });
  });

  it("resolves historical completion targets against historical content", async () => {
    const latestPlateContent = JSON.stringify([
      {
        type: "form_section_separator",
        blockId: "latest-completion",
        validation: {
          default_action: { type: "submit", target_id: "latest-completion" },
        },
        children: [{ type: "p", children: [{ text: "最新完了" }] }],
      },
    ]);
    const historicalPlateContent = JSON.stringify([
      {
        type: "form_section_separator",
        blockId: "historical-completion",
        validation: {
          default_action: {
            type: "submit",
            target_id: "historical-completion",
          },
        },
        children: [{ type: "p", children: [{ text: "履歴版完了" }] }],
      },
    ]);
    queryMockState.plateContent = latestPlateContent;
    queryMockState.snapshots = [
      {
        version: 2,
        publishedAt: "2026-07-01T00:00:00.000Z",
        isActive: false,
      },
    ];
    queryMockState.snapshotContent = {
      version: 2,
      publishedAt: "2026-07-01T00:00:00.000Z",
      plateContent: historicalPlateContent,
      appearance: historicalAppearance,
      confirmation: {
        title: "履歴版の確認タイトル",
        message: "履歴版の確認メッセージ",
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<FormPreviewPage />);
    });
    await act(async () => {
      fireEvent.change(
        getByRole(container, "combobox", { name: "プレビューバージョン" }),
        { target: { value: "2" } },
      );
    });
    await act(async () => {
      formBodyProps.at(-1)?.onSubmitRequest?.({
        completionTargetPageId: "historical-completion",
        responses: [],
        visitedQuestionIds: [],
      });
    });

    expect(formBodyProps.at(-1)?.submittedCompletionPageId).toBe(
      "historical-completion",
    );
    expect(formBodyProps.at(-1)?.plateContent).toBe(historicalPlateContent);
    expect(container.textContent).not.toContain("履歴版の確認タイトル");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the preview completion target after submit without calling public submit", async () => {
    queryMockState.useActualFormBody = true;
    queryMockState.plateContent = JSON.stringify([
      {
        type: "form_radio",
        blockId: "q-plan",
        validation: {
          required: true,
          options: [{ id: "vip", label: "VIP" }],
        },
        children: [{ type: "p", children: [{ text: "プラン" }] }],
      },
      {
        type: "form_section_separator",
        blockId: "section-complete-vip",
        validation: {
          default_action: {
            type: "submit",
            target_id: "section-complete-vip",
          },
        },
        children: [{ type: "p", children: [{ text: "VIP 完了" }] }],
      },
      { type: "p", children: [{ text: "VIP 向け完了メッセージ" }] },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<FormPreviewPage />);
    });
    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "VIP" }));
    });
    await act(async () => {
      fireEvent.click(getByRole(container, "button", { name: "回答を送信" }));
    });

    expect(container.textContent).toContain(
      "プレビュー送信です。回答レコード、検証ジョブ、通知、Sheets 同期は作成されません。",
    );
    expect(container.textContent).toContain("VIP 完了");
    expect(container.textContent).toContain("VIP 向け完了メッセージ");
    expect(container.textContent).not.toContain("回答を送信");
    expect(apiMocks.publicSubmitPost).not.toHaveBeenCalled();
    expect(apiMocks.rpc).not.toHaveBeenCalledWith(
      expect.objectContaining({ submit: expect.anything() }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the preview confirmation screen after submit without calling public submit", async () => {
    queryMockState.confirmation = {
      title: "送信ありがとうございました",
      message: "受付内容を確認できます。",
      show_response_summary: true,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<FormPreviewPage />);
    });
    await act(async () => {
      formBodyProps.at(-1)?.onSubmitRequest?.({
        responses: [
          {
            question_id: "q-name",
            question_title: "氏名",
            question_type: "short_text",
            value: "Alice",
          },
          {
            question_id: "q-grid",
            question_title: "行列",
            question_type: "custom_grid",
            responses: {
              row1: { col1: "選択A" },
            },
          },
        ],
        visitedQuestionIds: ["q-name"],
      });
    });

    expect(container.textContent).toContain("送信完了");
    expect(container.textContent).toContain("送信ありがとうございました");
    expect(container.textContent).toContain("受付内容を確認できます。");
    expect(container.textContent).toContain("回答サマリー");
    expect(container.textContent).toContain("氏名");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain('row1: {"col1":"選択A"}');
    expect(container.textContent).not.toContain("回答 ID");
    expect(apiMocks.publicSubmitPost).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to the default preview confirmation when stored confirmation is invalid", async () => {
    queryMockState.confirmation = {
      redirect_url: "ftp://example.test/legacy",
      title: "壊れた確認設定",
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<FormPreviewPage />);
    });
    await act(async () => {
      formBodyProps.at(-1)?.onSubmitRequest?.({
        responses: [],
        visitedQuestionIds: [],
      });
    });

    expect(container.textContent).toContain("送信完了");
    expect(container.textContent).toContain("ご回答ありがとうございます");
    expect(container.textContent).not.toContain("壊れた確認設定");
    expect(apiMocks.publicSubmitPost).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
