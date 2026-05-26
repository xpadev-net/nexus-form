import { AlignKit } from "./plugins/align-kit";
import { BasicBlocksKit } from "./plugins/basic-blocks-kit";
import { BasicMarksKit } from "./plugins/basic-marks-kit";
import { CalloutKit } from "./plugins/callout-kit";
import { CodeBlockKit } from "./plugins/code-block-kit";
import { ColumnKit } from "./plugins/column-kit";
import { DateKit } from "./plugins/date-kit";
import { FontKit } from "./plugins/font-kit";
import { FormQuestionKits } from "./plugins/form-questions/form-question-kits";
import { IndentKit } from "./plugins/indent-kit";
import { LineHeightKit } from "./plugins/line-height-kit";
import { LinkKit } from "./plugins/link-kit";
import { ListKit } from "./plugins/list-kit";
import { MathKit } from "./plugins/math-kit";
import { MediaKit } from "./plugins/media-kit";
import { MentionKit } from "./plugins/mention-kit";
import { TableKit } from "./plugins/table-kit";
import { TocKit } from "./plugins/toc-kit";
import { ToggleKit } from "./plugins/toggle-kit";

export const ViewerKit = [
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
  ...BasicMarksKit,
  ...FontKit,
  ...ListKit,
  ...IndentKit,
  ...AlignKit,
  ...LineHeightKit,
  ...FormQuestionKits,
];
