import {
  CalendarIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ClipboardListIcon,
  Code2,
  Columns3Icon,
  FileTextIcon,
  GaugeIcon,
  GridIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  LightbulbIcon,
  ListIcon,
  ListOrdered,
  PilcrowIcon,
  Quote,
  RadicalIcon,
  SeparatorHorizontalIcon,
  Square,
  StarIcon,
  Table,
  TableOfContentsIcon,
  TextIcon,
  TimerIcon,
} from "lucide-react";
import { KEYS, type TComboboxInputElement } from "platejs";
import type { PlateEditor, PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";
import type { ReactNode } from "react";

import {
  insertBlock,
  insertFormQuestion,
  insertInlineElement,
} from "@/components/editor/transforms";
import type { FormQuestionType } from "@/components/editor/plate-types";

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from "./inline-combobox";

type Group = {
  group: string;
  items: {
    icon: ReactNode;
    value: string;
    onSelect: (editor: PlateEditor, value: string) => void;
    className?: string;
    focusEditor?: boolean;
    keywords?: string[];
    label?: string;
  }[];
};

const groups: Group[] = [
  {
    group: "Basic blocks",
    items: [
      {
        icon: <PilcrowIcon />,
        keywords: ["paragraph"],
        label: "Text",
        value: KEYS.p,
      },
      {
        icon: <Heading1Icon />,
        keywords: ["title", "h1"],
        label: "Heading 1",
        value: KEYS.h1,
      },
      {
        icon: <Heading2Icon />,
        keywords: ["subtitle", "h2"],
        label: "Heading 2",
        value: KEYS.h2,
      },
      {
        icon: <Heading3Icon />,
        keywords: ["subtitle", "h3"],
        label: "Heading 3",
        value: KEYS.h3,
      },
      {
        icon: <ListIcon />,
        keywords: ["unordered", "ul", "-"],
        label: "Bulleted list",
        value: KEYS.ul,
      },
      {
        icon: <ListOrdered />,
        keywords: ["ordered", "ol", "1"],
        label: "Numbered list",
        value: KEYS.ol,
      },
      {
        icon: <Square />,
        keywords: ["checklist", "task", "checkbox", "[]"],
        label: "To-do list",
        value: KEYS.listTodo,
      },
      {
        icon: <ChevronRightIcon />,
        keywords: ["collapsible", "expandable"],
        label: "Toggle",
        value: KEYS.toggle,
      },
      {
        icon: <Code2 />,
        keywords: ["```"],
        label: "Code Block",
        value: KEYS.codeBlock,
      },
      {
        icon: <Table />,
        label: "Table",
        value: KEYS.table,
      },
      {
        icon: <Quote />,
        keywords: ["citation", "blockquote", "quote", ">"],
        label: "Blockquote",
        value: KEYS.blockquote,
      },
      {
        icon: <LightbulbIcon />,
        keywords: ["note"],
        label: "Callout",
        value: KEYS.callout,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value, { upsert: true });
      },
    })),
  },
  {
    group: "Advanced blocks",
    items: [
      {
        icon: <TableOfContentsIcon />,
        keywords: ["toc"],
        label: "Table of contents",
        value: KEYS.toc,
      },
      {
        icon: <Columns3Icon />,
        label: "3 columns",
        value: "action_three_columns",
      },
      {
        focusEditor: false,
        icon: <RadicalIcon />,
        label: "Equation",
        value: KEYS.equation,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value, { upsert: true });
      },
    })),
  },
  {
    group: "Inline",
    items: [
      {
        focusEditor: true,
        icon: <CalendarIcon />,
        keywords: ["time"],
        label: "Date",
        value: KEYS.date,
      },
      {
        focusEditor: false,
        icon: <RadicalIcon />,
        label: "Inline Equation",
        value: KEYS.inlineEquation,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertInlineElement(editor, value);
      },
    })),
  },
  {
    group: "Form questions",
    items: [
      {
        icon: <TextIcon />,
        keywords: ["short", "text", "input"],
        label: "Short text",
        value: "form_short_text",
      },
      {
        icon: <FileTextIcon />,
        keywords: ["long", "textarea", "paragraph"],
        label: "Long text",
        value: "form_long_text",
      },
      {
        icon: <CircleDotIcon />,
        keywords: ["radio", "single", "choice"],
        label: "Radio",
        value: "form_radio",
      },
      {
        icon: <CheckSquareIcon />,
        keywords: ["checkbox", "multiple", "choice"],
        label: "Checkbox",
        value: "form_checkbox",
      },
      {
        icon: <ChevronDownIcon />,
        keywords: ["dropdown", "select"],
        label: "Dropdown",
        value: "form_dropdown",
      },
      {
        icon: <GaugeIcon />,
        keywords: ["linear", "scale", "slider"],
        label: "Linear scale",
        value: "form_linear_scale",
      },
      {
        icon: <StarIcon />,
        keywords: ["rating", "star"],
        label: "Rating",
        value: "form_rating",
      },
      {
        icon: <GridIcon />,
        keywords: ["choice", "grid", "matrix"],
        label: "Choice grid",
        value: "form_choice_grid",
      },
      {
        icon: <ClipboardListIcon />,
        keywords: ["checkbox", "grid", "matrix"],
        label: "Checkbox grid",
        value: "form_checkbox_grid",
      },
      {
        icon: <CalendarIcon />,
        keywords: ["date", "calendar"],
        label: "Date",
        value: "form_date",
      },
      {
        icon: <TimerIcon />,
        keywords: ["time", "clock"],
        label: "Time",
        value: "form_time",
      },
      {
        icon: <SeparatorHorizontalIcon />,
        keywords: ["section", "separator", "divider"],
        label: "Section separator",
        value: "form_section_separator",
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertFormQuestion(editor, value as FormQuestionType);
      },
    })),
  },
];

export function SlashInputElement(
  props: PlateElementProps<TComboboxInputElement>,
) {
  const { editor, element } = props;

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="/">
        <InlineComboboxInput />

        <InlineComboboxContent>
          <InlineComboboxEmpty>No results</InlineComboboxEmpty>

          {groups.map(({ group, items }) => (
            <InlineComboboxGroup key={group}>
              <InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>

              {items.map(
                ({ focusEditor, icon, keywords, label, value, onSelect }) => (
                  <InlineComboboxItem
                    key={value}
                    value={value}
                    onClick={() => onSelect(editor, value)}
                    label={label}
                    focusEditor={focusEditor}
                    group={group}
                    keywords={keywords}
                  >
                    <div className="mr-2 text-muted-foreground">{icon}</div>
                    {label ?? value}
                  </InlineComboboxItem>
                ),
              )}
            </InlineComboboxGroup>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}
