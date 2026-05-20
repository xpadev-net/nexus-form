import {
  CalendarIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  CircleDotIcon,
  ClipboardListIcon,
  FileTextIcon,
  GaugeIcon,
  GridIcon,
  type LucideIcon,
  SeparatorHorizontalIcon,
  StarIcon,
  TextIcon,
  TimerIcon,
} from "lucide-react";
import {
  FORM_QUESTION_TYPES,
  type PlateQuestionType,
} from "@nexus-form/shared";
import { questionTypeLabels } from "@/lib/constants/form-question";

type FormQuestionMenuItemMetadata = {
  icon: LucideIcon;
  keywords: string[];
};

const FORM_QUESTION_MENU_ITEM_METADATA: Record<
  PlateQuestionType,
  FormQuestionMenuItemMetadata
> = {
  form_short_text: {
    icon: TextIcon,
    keywords: ["short", "text", "input"],
  },
  form_long_text: {
    icon: FileTextIcon,
    keywords: ["long", "textarea", "paragraph"],
  },
  form_radio: {
    icon: CircleDotIcon,
    keywords: ["radio", "single", "choice"],
  },
  form_checkbox: {
    icon: CheckSquareIcon,
    keywords: ["checkbox", "multiple", "choice"],
  },
  form_dropdown: {
    icon: ChevronDownIcon,
    keywords: ["dropdown", "select"],
  },
  form_linear_scale: {
    icon: GaugeIcon,
    keywords: ["linear", "scale", "slider"],
  },
  form_rating: {
    icon: StarIcon,
    keywords: ["rating", "star"],
  },
  form_choice_grid: {
    icon: GridIcon,
    keywords: ["choice", "grid", "matrix"],
  },
  form_checkbox_grid: {
    icon: ClipboardListIcon,
    keywords: ["checkbox", "grid", "matrix"],
  },
  form_date: {
    icon: CalendarIcon,
    keywords: ["date", "calendar"],
  },
  form_time: {
    icon: TimerIcon,
    keywords: ["time", "clock"],
  },
  form_section_separator: {
    icon: SeparatorHorizontalIcon,
    keywords: ["section", "separator", "divider"],
  },
};

export const FORM_QUESTION_MENU_ITEMS = FORM_QUESTION_TYPES.map((value) => {
  const { icon: Icon, ...metadata } = FORM_QUESTION_MENU_ITEM_METADATA[value];

  return {
    ...metadata,
    icon: <Icon />,
    label: questionTypeLabels[value],
    value,
  };
});
