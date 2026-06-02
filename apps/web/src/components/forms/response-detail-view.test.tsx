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

vi.mock("./validation-result-list", () => ({
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
                values: ["ts", "react"],
                display_values: ["TypeScript", "React"],
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
                display_value: "月曜: 午前, 夜\n火曜: 未回答",
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
              {
                question_id: "blank-other",
                question_type: "radio",
                question_title: "その他なし",
                value: "option-a",
                display_value: "選択肢A",
                other_value: null,
              },
              {
                question_id: "empty-other",
                question_type: "radio",
                question_title: "空のその他",
                value: "選択肢B",
                other_value: "",
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
    expect(container.textContent).toContain("月曜: 午前, 夜");
    expect(container.textContent).toContain("火曜: 未回答");
    expect(container.textContent).toContain("未設定の質問 (secure-field)");
    expect(container.textContent).toContain("暗号化済みの回答");
    expect(container.textContent).toContain("分類 (metadata-like)");
    expect(container.textContent).toContain('"tag": "sports"');
    expect(container.textContent).toContain('"label": "Soccer"');
    expect(container.textContent).toContain("その他なし (blank-other)");
    expect(container.textContent).toContain("選択肢A");
    expect(container.textContent).toContain("空のその他 (empty-other)");
    expect(container.textContent).toContain("選択肢B");
    expect(container.textContent).not.toContain("その他: 未回答");
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

  it("falls back to the empty response state when detail data has no response payload", () => {
    useValidationResultsMock.mockReturnValue({
      validationResultsQuery: {
        data: {},
        isError: false,
        isLoading: false,
      },
    });
    const container = document.createElement("div");

    const root = renderResponseDetail(container);

    expect(container.textContent).toContain("回答内容はありません。");

    act(() => root.unmount());
  });

  it("renders duplicate question IDs as separate answer cards", () => {
    useValidationResultsMock.mockReturnValue({
      validationResultsQuery: {
        data: {
          response: {
            responseDataJson: JSON.stringify([
              {
                question_id: "duplicate",
                question_type: "short_text",
                question_title: "重複質問",
                value: "1つ目",
              },
              {
                question_id: "duplicate",
                question_type: "short_text",
                question_title: "重複質問",
                value: "2つ目",
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

    expect(container.textContent).toContain("1つ目");
    expect(container.textContent).toContain("2つ目");
    expect(container.querySelectorAll(".rounded.border.p-3")).toHaveLength(2);

    act(() => root.unmount());
  });
});
