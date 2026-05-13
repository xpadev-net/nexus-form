import { LinkPlugin } from "@platejs/link/react";
import { LinkElement, LinkFloatingToolbar } from "@/components/ui/link-node";

export const LinkKit = [
  LinkPlugin.configure({
    render: {
      node: LinkElement,
      afterEditable: () => <LinkFloatingToolbar />,
    },
  }),
];
