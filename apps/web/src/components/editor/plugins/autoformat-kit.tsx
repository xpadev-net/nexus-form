import type { AutoformatRule } from "@platejs/autoformat";
import { AutoformatPlugin } from "@platejs/autoformat";
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HighlightPlugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { CodeBlockPlugin } from "@platejs/code-block/react";

const markRules: AutoformatRule[] = [
  {
    match: "**",
    mode: "mark",
    type: BoldPlugin.key,
  },
  {
    match: "*",
    mode: "mark",
    type: ItalicPlugin.key,
  },
  {
    match: "_",
    mode: "mark",
    type: ItalicPlugin.key,
  },
  {
    match: "__",
    mode: "mark",
    type: UnderlinePlugin.key,
  },
  {
    match: "~~",
    mode: "mark",
    type: StrikethroughPlugin.key,
  },
  {
    match: "`",
    mode: "mark",
    type: CodePlugin.key,
  },
  {
    match: "^",
    mode: "mark",
    type: SuperscriptPlugin.key,
  },
  {
    match: "~",
    mode: "mark",
    type: SubscriptPlugin.key,
  },
  {
    match: "==",
    mode: "mark",
    type: HighlightPlugin.key,
  },
];

const blockRules: AutoformatRule[] = [
  {
    match: "# ",
    mode: "block",
    type: H1Plugin.key,
  },
  {
    match: "## ",
    mode: "block",
    type: H2Plugin.key,
  },
  {
    match: "### ",
    mode: "block",
    type: H3Plugin.key,
  },
  {
    match: "#### ",
    mode: "block",
    type: H4Plugin.key,
  },
  {
    match: "##### ",
    mode: "block",
    type: H5Plugin.key,
  },
  {
    match: "###### ",
    mode: "block",
    type: H6Plugin.key,
  },
  {
    match: "> ",
    mode: "block",
    type: BlockquotePlugin.key,
  },
  {
    match: ["---", "—-", "___"],
    mode: "block",
    type: HorizontalRulePlugin.key,
  },
  {
    match: "```",
    mode: "block",
    type: CodeBlockPlugin.key,
  },
];

export const AutoformatKit = [
  AutoformatPlugin.configure({
    options: {
      rules: [...markRules, ...blockRules],
      enableUndoOnDelete: true,
    },
  }),
];
