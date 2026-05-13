import {
  BlockMenuPlugin,
  BlockSelectionPlugin,
} from "@platejs/selection/react";
import { KEYS } from "platejs";
import { BlockContextMenu } from "@/components/ui/block-context-menu";
import { BlockSelection } from "@/components/ui/block-selection";

export const BlockSelectionKit = [
  BlockSelectionPlugin.configure(() => ({
    options: {
      enableContextMenu: true,
      isSelectable: (element) => {
        const nonSelectableTypes: string[] = [
          KEYS.column,
          KEYS.codeLine,
          KEYS.td,
        ];
        return !nonSelectableTypes.includes(element.type);
      },
    },
    render: {
      belowRootNodes: (props) => <BlockSelection {...props} />,
    },
  })),
];

export const BlockMenuKit = [
  ...BlockSelectionKit,
  BlockMenuPlugin.configure({
    render: { aboveEditable: BlockContextMenu },
  }),
];
