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
const formBodyProps = vi.hoisted(
  () =>
    [] as Array<{
      appearance?: FormAppearance;
      onSubmitRequest?: (data: FormSubmitRequestData) => void;
      submittedCompletionPageId?: string | null;
    }>,
);
const queryMockState = vi.hoisted(() => ({
  confirmation: undefined as
    | {
        message?: string;
        show_response_summary?: boolean;
        title?: string;
      }
    | undefined,
  loadingKeys: [] as string[],
  plateContent: "[]" as string,
  renderSubmitButton: false,
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
      submittedCompletionPageId?: string | null;
    }) => {
      formBodyProps.push(props);
      if (queryMockState.useActualFormBody) {
        return (
          <actual.FormBody
            {...props}
            mode="preview"
            plateContent={queryMockState.plateContent}
            title="Preview form"
          />
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
    data: null,
    error: null,
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@/hooks/forms/use-snapshots", () => ({
  useSnapshots: () => ({
    snapshotsQuery: { data: { snapshots: [] }, error: null },
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
    expect(container.textContent).not.toContain("回答 ID");
    expect(apiMocks.publicSubmitPost).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
