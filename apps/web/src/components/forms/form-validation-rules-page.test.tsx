// @vitest-environment jsdom

import type {
  ListValidationProvidersResponse,
  ValidationProviderItem,
} from "@nexus-form/shared";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormValidationRulesPage } from "./form-validation-rules-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface RuleDtoFixture {
  id: string;
  name: string;
  providerName: string;
  ruleType: string;
  referencedBlockIds: string[];
  configJson: Record<string, unknown>;
  orderIndex: number;
}

const provider = {
  name: "discord",
  label: "Discord",
  description: "Discord validation",
  rules: [
    {
      name: "member",
      label: "Member",
      description: "Checks Discord membership",
      inputHint: "Discord ID を入力してください",
      configFields: [
        {
          name: "guildId",
          label: "Guild ID",
          kind: "text",
        },
        {
          name: "level",
          label: "Level",
          kind: "select",
          options: [
            { value: "basic", label: "Basic" },
            { value: "trusted", label: "Trusted" },
          ],
        },
        {
          name: "roles",
          label: "Roles",
          kind: "multiselect",
          options: [
            { value: "member", label: "Member" },
            { value: "admin", label: "Admin" },
            { value: "member-admin", label: "Member Admin" },
          ],
        },
        {
          name: "roles-member",
          label: "Role member",
          kind: "multiselect",
          options: [{ value: "admin", label: "Admin" }],
        },
        {
          name: "mode",
          label: "Mode",
          kind: "radio",
          options: [
            { value: "any", label: "Any" },
            { value: "all", label: "All" },
          ],
        },
      ],
    },
  ],
} satisfies ValidationProviderItem;

const providersResponse = {
  success: true,
  data: [provider],
} satisfies ListValidationProvidersResponse;

const plateContent = JSON.stringify([
  {
    type: "form_short_text",
    blockId: "discord-id",
    children: [{ type: "p", children: [{ text: "Discord ID" }] }],
  },
]);

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationMutate: vi.fn(),
  optionRefetch: vi.fn(),
  providersData: undefined as ListValidationProvidersResponse | undefined,
  providersError: null as Error | null,
  providersIsError: false,
  providersIsLoading: false,
  providersRefetch: vi.fn(),
  rulesData: undefined as RuleDtoFixture[] | undefined,
  rulesError: null as Error | null,
  rulesIsError: false,
  rulesIsLoading: false,
  rulesRefetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    isPending: false,
    mutate: mocks.mutationMutate,
  }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[0] === "validationRules") {
      return {
        data: mocks.rulesData,
        error: mocks.rulesError,
        isError: mocks.rulesIsError,
        isLoading: mocks.rulesIsLoading,
        refetch: mocks.rulesRefetch,
      };
    }
    return {
      data: [],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.optionRefetch,
    };
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/lib/validation/validation-providers", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/validation/validation-providers")
    >();
  return {
    ...actual,
    useValidationProviders: () => ({
      data: mocks.providersData,
      error: mocks.providersError,
      isError: mocks.providersIsError,
      isLoading: mocks.providersIsLoading,
      refetch: mocks.providersRefetch,
    }),
  };
});

vi.mock("@/lib/api", () => ({
  client: { api: { forms: { ":id": { "validation-rules": {} } } } },
  rpc: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: ComponentProps<"button"> & {
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => (
    <section data-testid="validation-rule-card">{children}</section>
  ),
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked: _checked,
    onCheckedChange: _onCheckedChange,
    ...props
  }: ComponentProps<"input"> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => <input type="checkbox" {...props} />,
}));

vi.mock("@/components/ui/composition-aware-input", () => ({
  CompositionAwareInput: (props: ComponentProps<"input">) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, className, htmlFor }: ComponentProps<"label">) =>
    htmlFor ? (
      <label className={className} htmlFor={htmlFor}>
        {children}
      </label>
    ) : (
      <span className={className}>{children}</span>
    ),
}));

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({
    children,
    value: _value,
    onValueChange: _onValueChange,
    ...props
  }: ComponentProps<"div"> & {
    value?: string;
    onValueChange?: (value: string) => void;
  }) => <div {...props}>{children}</div>,
  RadioGroupItem: (props: ComponentProps<"input">) => (
    <input type="radio" {...props} />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value: _value,
    onValueChange: _onValueChange,
    ...props
  }: ComponentProps<"div"> & {
    value?: string;
    onValueChange?: (value: string) => void;
  }) => <div {...props}>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: ComponentProps<"button"> & {
    id?: string;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: ComponentProps<"div">) => <div {...props} />,
}));

function ruleFixture(id: string): RuleDtoFixture {
  return {
    id,
    name: `Rule ${id}`,
    providerName: "discord",
    ruleType: "member",
    referencedBlockIds: ["discord-id"],
    configJson: {
      guildId: "guild-1",
      level: "basic",
      mode: "any",
      roles: ["member"],
    },
    orderIndex: 0,
  };
}

function renderPage(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormValidationRulesPage formId="form-1" plateContent={plateContent} />,
    );
  });
  return root;
}

describe("FormValidationRulesPage", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockClear();
    mocks.mutationMutate.mockClear();
    mocks.optionRefetch.mockClear();
    mocks.providersRefetch.mockClear();
    mocks.rulesRefetch.mockClear();
    mocks.providersData = providersResponse;
    mocks.providersError = null;
    mocks.providersIsError = false;
    mocks.providersIsLoading = false;
    mocks.rulesData = [];
    mocks.rulesError = null;
    mocks.rulesIsError = false;
    mocks.rulesIsLoading = false;
  });

  it("shows a retryable providers error without rendering the empty state", () => {
    const container = document.createElement("div");
    mocks.providersData = undefined;
    mocks.providersError = new Error("providers failed");
    mocks.providersIsError = true;

    const root = renderPage(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "providers failed",
    );
    expect(container.textContent).not.toContain("検証ルールはまだありません");
    const retryButton = container.querySelector(
      '[data-testid="validation-providers-query-retry"]',
    );
    expect(retryButton).not.toBeNull();
    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.providersRefetch).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("shows a retryable rules error without rendering the empty state", () => {
    const container = document.createElement("div");
    mocks.rulesData = undefined;
    mocks.rulesError = new Error("rules failed");
    mocks.rulesIsError = true;

    const root = renderPage(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "rules failed",
    );
    expect(container.textContent).not.toContain("検証ルールはまだありません");
    const retryButton = container.querySelector(
      '[data-testid="validation-rules-query-retry"]',
    );
    expect(retryButton).not.toBeNull();
    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.rulesRefetch).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("shows both retryable errors when providers and rules fail together", () => {
    const container = document.createElement("div");
    mocks.providersData = undefined;
    mocks.providersError = new Error("providers failed");
    mocks.providersIsError = true;
    mocks.rulesData = undefined;
    mocks.rulesError = new Error("rules failed");
    mocks.rulesIsError = true;

    const root = renderPage(container);

    const alerts = Array.from(container.querySelectorAll('[role="alert"]'));
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      expect.stringContaining("providers failed"),
      expect.stringContaining("rules failed"),
    ]);
    expect(container.textContent).not.toContain("検証ルールはまだありません");
    expect(
      container.querySelector(
        '[data-testid="validation-providers-query-retry"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="validation-rules-query-retry"]'),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("keeps config control ids unique and labels scoped to each rule card", () => {
    const container = document.createElement("div");
    mocks.rulesData = [ruleFixture("rule-a"), ruleFixture("rule-b")];

    const root = renderPage(container);

    const ids = Array.from(container.querySelectorAll("[id]")).map(
      (element) => element.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "rule-rule-a-config-guildId",
        "rule-rule-a-config-level",
        "rule-rule-a-config-roles::member",
        "rule-rule-a-config-roles::member-admin",
        "rule-rule-a-config-roles-member::admin",
        "rule-rule-a-config-mode::any",
        "rule-rule-b-config-guildId",
        "rule-rule-b-config-level",
        "rule-rule-b-config-roles::member",
        "rule-rule-b-config-roles::member-admin",
        "rule-rule-b-config-roles-member::admin",
        "rule-rule-b-config-mode::any",
      ]),
    );

    const cards = Array.from(
      container.querySelectorAll('[data-testid="validation-rule-card"]'),
    );
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const labels = Array.from(card.querySelectorAll("label[for]"));
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        const targetId = label.getAttribute("for");
        expect(targetId).not.toBeNull();
        expect(card.querySelector(`[id="${targetId}"]`)).not.toBeNull();
      }
    }

    act(() => root.unmount());
  });
});
