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

type FormQuestionMenuItemMetadata = {
  icon: LucideIcon;
  keywords: string[];
  label: string;
};

const FORM_QUESTION_MENU_ITEM_METADATA: Record<
  PlateQuestionType,
  FormQuestionMenuItemMetadata
> = {
  form_short_text: {
    icon: TextIcon,
    keywords: ["short", "text", "input"],
    label: "Short text",
  },
  form_long_text: {
    icon: FileTextIcon,
    keywords: ["long", "textarea", "paragraph"],
    label: "Long text",
  },
  form_radio: {
    icon: CircleDotIcon,
    keywords: ["radio", "single", "choice"],
    label: "Radio",
  },
  form_checkbox: {
    icon: CheckSquareIcon,
    keywords: ["checkbox", "multiple", "choice"],
    label: "Checkbox",
  },
  form_dropdown: {
    icon: ChevronDownIcon,
    keywords: ["dropdown", "select"],
    label: "Dropdown",
  },
  form_linear_scale: {
    icon: GaugeIcon,
    keywords: ["linear", "scale", "slider"],
    label: "Linear scale",
  },
  form_rating: {
    icon: StarIcon,
    keywords: ["rating", "star"],
    label: "Rating",
  },
  form_choice_grid: {
    icon: GridIcon,
    keywords: ["choice", "grid", "matrix"],
    label: "Choice grid",
  },
  form_checkbox_grid: {
    icon: ClipboardListIcon,
    keywords: ["checkbox", "grid", "matrix"],
    label: "Checkbox grid",
  },
  form_date: {
    icon: CalendarIcon,
    keywords: ["date", "calendar"],
    label: "Date",
  },
  form_time: {
    icon: TimerIcon,
    keywords: ["time", "clock"],
    label: "Time",
  },
  form_section_separator: {
    icon: SeparatorHorizontalIcon,
    keywords: ["section", "separator", "divider"],
    label: "Section separator",
  },
};

export const FORM_QUESTION_MENU_ITEMS = FORM_QUESTION_TYPES.map((value) => {
  const { icon: Icon, ...metadata } = FORM_QUESTION_MENU_ITEM_METADATA[value];

  return {
    ...metadata,
    icon: <Icon />,
    value,
  };
});
