import { ListPlugin } from "@platejs/list/react";
import { KEYS } from "platejs";
import { BlockList } from "@/components/ui/block-list";

export const ListKit = [
  ListPlugin.configure({
    inject: {
      targetPlugins: [
        ...KEYS.heading,
        KEYS.p,
        KEYS.blockquote,
        KEYS.codeBlock,
        KEYS.toggle,
        KEYS.img,
      ],
    },
    render: { belowNodes: BlockList },
  }),
];
