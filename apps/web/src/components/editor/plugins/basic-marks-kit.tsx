import {
  BoldPlugin,
  CodePlugin,
  HighlightPlugin,
  ItalicPlugin,
  KbdPlugin,
  StrikethroughPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { CodeLeaf } from "@/components/ui/code-node";
import { HighlightLeaf } from "@/components/ui/highlight-node";
import { KbdLeaf } from "@/components/ui/kbd-node";

export const BasicMarksKit = [
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  CodePlugin.withComponent(CodeLeaf),
  StrikethroughPlugin,
  SubscriptPlugin.configure({
    shortcuts: { toggle: { keys: "mod+," } },
  }),
  SuperscriptPlugin.configure({
    shortcuts: { toggle: { keys: "mod+." } },
  }),
  HighlightPlugin.configure({
    node: { component: HighlightLeaf },
    shortcuts: { toggle: { keys: "mod+shift+h" } },
  }),
  KbdPlugin.withComponent(KbdLeaf),
];
