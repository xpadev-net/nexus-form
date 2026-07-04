// @vitest-environment jsdom

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationManager } from "./invitation-manager";
import { PermissionEditor } from "./permission-editor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type PermissionRole = "OWNER" | "EDITOR" | "VIEWER";

type PermissionRecord = {
  role: PermissionRole;
  user_id: string;
};

type InvitationRecord = {
  email: string;
  id: string;
  role: "EDITOR" | "VIEWER";
};

const mocks = vi.hoisted(
  (): {
    createInvitationMutate: ReturnType<typeof vi.fn>;
    removePermissionMutate: ReturnType<typeof vi.fn>;
    toastSuccess: ReturnType<typeof vi.fn>;
    updatePermissionMutate: ReturnType<typeof vi.fn>;
    useFormPermissionsState: {
      invitationsQuery: {
        data: { invitations: InvitationRecord[] };
        error: Error | null;
        isError: boolean;
        isLoading: boolean;
        refetch: ReturnType<typeof vi.fn>;
      };
      permissionsQuery: {
        data: { permissions: PermissionRecord[] };
        error: Error | null;
        isError: boolean;
        isLoading: boolean;
        refetch: ReturnType<typeof vi.fn>;
      };
    };
  } => ({
    createInvitationMutate: vi.fn(),
    removePermissionMutate: vi.fn(),
    toastSuccess: vi.fn(),
    updatePermissionMutate: vi.fn(),
    useFormPermissionsState: {
      invitationsQuery: {
        data: { invitations: [] },
        error: null,
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      },
      permissionsQuery: {
        data: {
          permissions: [
            { role: "OWNER", user_id: "owner-1" },
            { role: "EDITOR", user_id: "target-user" },
          ],
        },
        error: null,
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      },
    },
  }),
);

function renderNode(container: HTMLElement, node: ReactNode): Root {
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return root;
}

vi.mock("@/hooks/forms/use-form-permissions", () => ({
  useFormPermissions: () => ({
    createInvitationMutation: {
      isPending: false,
      mutate: mocks.createInvitationMutate,
    },
    deleteInvitationMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    invitationsQuery: mocks.useFormPermissionsState.invitationsQuery,
    permissionsQuery: mocks.useFormPermissionsState.permissionsQuery,
    removePermissionMutation: {
      isPending: false,
      mutate: mocks.removePermissionMutate,
    },
    updatePermissionMutation: {
      mutate: mocks.updatePermissionMutate,
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild: _asChild,
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    onValueChange?: (value: string) => void;
  }) => (
    <div>
      {children}
      <button
        type="button"
        data-testid="select-viewer"
        onClick={() => onValueChange?.("VIEWER")}
      >
        viewer
      </button>
      <button
        type="button"
        data-testid="select-editor"
        onClick={() => onValueChange?.("EDITOR")}
      >
        editor
      </button>
    </div>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
  SelectValue: () => <span />,
}));

describe("R23-T3 sharing and permission UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useFormPermissionsState.permissionsQuery = {
      data: {
        permissions: [
          { role: "OWNER", user_id: "owner-1" },
          { role: "EDITOR", user_id: "target-user" },
        ],
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
    mocks.useFormPermissionsState.invitationsQuery = {
      data: { invitations: [] },
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
  });

  it("sends a mocked email invitation with the selected EDITOR role", () => {
    const container = document.createElement("div");
    const root = renderNode(container, <InvitationManager formId="form-1" />);
    const input = container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    );
    if (!input) throw new Error("email input was not rendered");

    act(() => {
      input.value = " target@example.com ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="select-editor"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const inviteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("招待"),
    );
    if (!inviteButton) throw new Error("invite button was not rendered");

    act(() => {
      inviteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.createInvitationMutate).toHaveBeenCalledWith(
      { email: "target@example.com", role: "EDITOR" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    act(() => root.unmount());
  });

  it("updates a collaborator from EDITOR to VIEWER and removes access", () => {
    const container = document.createElement("div");
    const root = renderNode(container, <PermissionEditor formId="form-1" />);

    expect(container.textContent).toContain("target-user");
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="select-viewer"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const removeButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="権限を削除"]',
    );
    expect(removeButtons).toHaveLength(1);
    act(() => {
      removeButtons[0]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mocks.updatePermissionMutate).toHaveBeenCalledWith({
      userId: "target-user",
      role: "VIEWER",
    });
    expect(mocks.removePermissionMutate).toHaveBeenCalledWith("target-user");

    act(() => root.unmount());
  });
});
