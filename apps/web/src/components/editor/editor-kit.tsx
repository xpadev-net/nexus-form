import { TrailingBlockPlugin } from "platejs";
import { AutoformatKit } from "./plugins/autoformat-kit";
import { BlockMenuKit } from "./plugins/block-menu-kit";
import { BlockPlaceholderKit } from "./plugins/block-placeholder-kit";
import { CommentKit } from "./plugins/comment-kit";
import { CursorOverlayKit } from "./plugins/cursor-overlay-kit";
import { DndKit } from "./plugins/dnd-kit";
import { DocxKit } from "./plugins/docx-kit";
import { EmojiKit } from "./plugins/emoji-kit";
import { ExitBreakKit } from "./plugins/exit-break-kit";
import { FixedToolbarKit } from "./plugins/fixed-toolbar-kit";
import { FloatingToolbarKit } from "./plugins/floating-toolbar-kit";
import { MarkdownKit } from "./plugins/markdown-kit";
import { SlashKit } from "./plugins/slash-kit";
import { SuggestionKit } from "./plugins/suggestion-kit";
import { ViewerKit } from "./viewer-kit";

export const EditorKit = [
  ...ViewerKit,

  // Editing features
  ...SlashKit,
  ...AutoformatKit,
  ...CursorOverlayKit,
  ...BlockMenuKit,
  ...DndKit,
  ...EmojiKit,
  ...ExitBreakKit,
  TrailingBlockPlugin,

  // Comments & Suggestions
  ...CommentKit,
  ...SuggestionKit,

  // Parsers
  ...DocxKit,
  ...MarkdownKit,

  // UI
  ...BlockPlaceholderKit,
  ...FixedToolbarKit,
  ...FloatingToolbarKit,
];
