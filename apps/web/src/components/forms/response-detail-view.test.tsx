// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResponseDetailView } from "./response-detail-view";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { useValidationResultsMock } = vi.hoisted(() => ({
  useValidationResultsMock: vi.fn(),
}));

vi.mock("@/hooks/forms/use-validation-results", () => ({
  useValidationResults: useValidationResultsMock,
}));

vi.mock("@/components/forms/validation-result-list", () => ({
  ValidationResultList: () => <section data-testid="validation-results" />,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & {
    children: ReactNode;
  }) => <span {...props}>{children}</span>,
}));

function renderResponseDetail(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<ResponseDetailView formId="form-1" responseId="response-1" />);
  });
  return root;
}

beforeEach(() => {
  useValidationResultsMock.mockReset();
});

describe("ResponseDetailView", () => {
  it("renders responseDataJson answers from the detail API", () => {
    useValidationResultsMock.mockReturnValue({
      validationResultsQuery: {
        data: {
          response: {
            responseDataJson: JSON.stringify([
              {
                question_id: "name",
                question_type: "short_text",
                question_title: "氏名",
                value: "山田 太郎",
              },
              {
                question_id: "interests",
                question_type: "checkbox",
                question_title: "興味",
                values: ["TypeScript", "React"],
                other_value: "アクセシビリティ",
              },
              {
                question_id: "availability",
                question_type: "checkbox_grid",
                question_title: "参加可能日",
                responses: {
                  monday: ["morning", "evening"],
                  tuesday: [],
                },
              },
              {
                question_id: "secure-field",
                question_type: "short_text",
                value: { ciphertext: "secret", iv: "nonce" },
              },
              {
                question_id: "metadata-like",
                question_type: "short_text",
                question_title: "分類",
                value: { tag: "sports", label: "Soccer" },
              },
            ]),
          },
        },
        isError: false,
        isLoading: false,
      },
    });
    const container = document.createElement("div");

    const root = renderResponseDetail(container);

    expect(container.textContent).toContain("氏名 (name)");
    expect(container.textContent).toContain("山田 太郎");
    expect(container.textContent).toContain("興味 (interests)");
    expect(container.textContent).toContain("TypeScript, React");
    expect(container.textContent).toContain("その他: アクセシビリティ");
    expect(container.textContent).toContain("参加可能日 (availability)");
    expect(container.textContent).toContain("monday: morning, evening");
    expect(container.textContent).toContain("tuesday: 未回答");
    expect(container.textContent).toContain("未設定の質問 (secure-field)");
    expect(container.textContent).toContain("暗号化済みの回答");
    expect(container.textContent).toContain("分類 (metadata-like)");
    expect(container.textContent).toContain('"tag": "sports"');
    expect(container.textContent).toContain('"label": "Soccer"');
    expect(container.textContent).not.toContain("回答内容はありません。");

    act(() => root.unmount());
  });

  it("keeps valid answers visible when one responseDataJson item is malformed", () => {
    useValidationResultsMock.mockReturnValue({
      validationResultsQuery: {
        data: {
          response: {
            responseDataJson: JSON.stringify([
              {
                question_id: "valid-question",
                question_type: "short_text",
                question_title: "有効な質問",
                value: "表示される回答",
              },
              {
                question_id: "",
                question_type: "checkbox",
                question_title: "壊れた質問",
                values: null,
              },
            ]),
          },
        },
        isError: false,
        isLoading: false,
      },
    });
    const container = document.createElement("div");

    const root = renderResponseDetail(container);

    expect(container.textContent).toContain("有効な質問 (valid-question)");
    expect(container.textContent).toContain("表示される回答");
    expect(container.textContent).not.toContain("壊れた質問");
    expect(container.textContent).not.toContain("回答内容はありません。");

    act(() => root.unmount());
  });

  it("falls back to the empty response state when responseDataJson is malformed", () => {
    useValidationResultsMock.mockReturnValue({
      validationResultsQuery: {
        data: {
          response: {
            responseDataJson: "{",
          },
        },
        isError: false,
        isLoading: false,
      },
    });
    const container = document.createElement("div");

    const root = renderResponseDetail(container);

    expect(container.textContent).toContain("回答内容はありません。");
    expect(container.textContent).toContain("response-1");

    act(() => root.unmount());
  });
});
