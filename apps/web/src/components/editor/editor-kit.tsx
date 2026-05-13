import { TrailingBlockPlugin } from "platejs";
import { AlignKit } from "./plugins/align-kit";
import { AutoformatKit } from "./plugins/autoformat-kit";
// ViewerKit plugins (rendering only)
import { BasicBlocksKit } from "./plugins/basic-blocks-kit";
import { BasicMarksKit } from "./plugins/basic-marks-kit";
import { BlockMenuKit } from "./plugins/block-menu-kit";
import { BlockPlaceholderKit } from "./plugins/block-placeholder-kit";
import { CalloutKit } from "./plugins/callout-kit";
import { CodeBlockKit } from "./plugins/code-block-kit";
import { ColumnKit } from "./plugins/column-kit";
import { CommentKit } from "./plugins/comment-kit";
import { CursorOverlayKit } from "./plugins/cursor-overlay-kit";
import { DateKit } from "./plugins/date-kit";
import { DndKit } from "./plugins/dnd-kit";
import { DocxKit } from "./plugins/docx-kit";
import { EmojiKit } from "./plugins/emoji-kit";
import { ExitBreakKit } from "./plugins/exit-break-kit";
import { FixedToolbarKit } from "./plugins/fixed-toolbar-kit";
import { FloatingToolbarKit } from "./plugins/floating-toolbar-kit";
import { FontKit } from "./plugins/font-kit";
import { FormQuestionKits } from "./plugins/form-questions/form-question-kits";
import { IndentKit } from "./plugins/indent-kit";
import { LineHeightKit } from "./plugins/line-height-kit";
import { LinkKit } from "./plugins/link-kit";
import { ListKit } from "./plugins/list-kit";
import { MarkdownKit } from "./plugins/markdown-kit";
import { MathKit } from "./plugins/math-kit";
import { MediaKit } from "./plugins/media-kit";
import { MentionKit } from "./plugins/mention-kit";
// EditorKit-only plugins (editing features)
import { SlashKit } from "./plugins/slash-kit";
import { SuggestionKit } from "./plugins/suggestion-kit";
import { TableKit } from "./plugins/table-kit";
import { TocKit } from "./plugins/toc-kit";
import { ToggleKit } from "./plugins/toggle-kit";

// ViewerKit: plugins needed for rendering content (read-only)
export const ViewerKit = [
  // Elements
  ...BasicBlocksKit,
  ...CodeBlockKit,
  ...TableKit,
  ...ToggleKit,
  ...TocKit,
  ...MediaKit,
  ...CalloutKit,
  ...ColumnKit,
  ...MathKit,
  ...DateKit,
  ...LinkKit,
  ...MentionKit,

  // Marks
  ...BasicMarksKit,
  ...FontKit,

  // Block styles
  ...ListKit,
  ...IndentKit,
  ...AlignKit,
  ...LineHeightKit,

  // Form question elements
  ...FormQuestionKits,
];

// EditorKit: ViewerKit + editing features
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
