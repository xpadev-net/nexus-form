import { fromPlateQuestionType, toPlateQuestionType } from "@nexus-form/shared";
import { insertCallout } from "@platejs/callout";
import { insertCodeBlock, toggleCodeBlock } from "@platejs/code-block";
import { insertDate } from "@platejs/date";
import { insertColumnGroup, toggleColumnGroup } from "@platejs/layout";
import { triggerFloatingLink } from "@platejs/link/react";
import { insertEquation, insertInlineEquation } from "@platejs/math";
import { insertMedia } from "@platejs/media";
import { TablePlugin } from "@platejs/table/react";
import { insertToc } from "@platejs/toc";
import {
  KEYS,
  type NodeEntry,
  type Path,
  PathApi,
  type TElement,
} from "platejs";
import type { PlateEditor } from "platejs/react";

import {
  FORM_QUESTION_TYPES,
  type FormQuestionType,
  isFormQuestionType,
} from "./plate-types";

const ACTION_THREE_COLUMNS = "action_three_columns";

const insertList = (editor: PlateEditor, type: string) => {
  editor.tf.insertNodes(
    editor.api.create.block({
      indent: 1,
      listStyleType: type,
    }),
    { select: true },
  );
};

const insertBlockMap: Record<
  string,
  (editor: PlateEditor, type: string) => void
> = {
  [KEYS.listTodo]: insertList,
  [KEYS.ol]: insertList,
  [KEYS.ul]: insertList,
  [ACTION_THREE_COLUMNS]: (editor) =>
    insertColumnGroup(editor, { columns: 3, select: true }),
  [KEYS.callout]: (editor) => insertCallout(editor, { select: true }),
  [KEYS.codeBlock]: (editor) => insertCodeBlock(editor, { select: true }),
  [KEYS.equation]: (editor) => insertEquation(editor, { select: true }),
  [KEYS.img]: (editor) =>
    insertMedia(editor, {
      select: true,
      type: KEYS.img,
    }),
  [KEYS.mediaEmbed]: (editor) =>
    insertMedia(editor, {
      select: true,
      type: KEYS.mediaEmbed,
    }),
  [KEYS.table]: (editor) =>
    editor.getTransforms(TablePlugin).insert.table({}, { select: true }),
  [KEYS.toc]: (editor) => insertToc(editor, { select: true }),
};

const insertInlineMap: Record<
  string,
  (editor: PlateEditor, type: string) => void
> = {
  [KEYS.date]: (editor) => insertDate(editor, { select: true }),
  [KEYS.inlineEquation]: (editor) =>
    insertInlineEquation(editor, "", { select: true }),
  [KEYS.link]: (editor) => triggerFloatingLink(editor, { focused: true }),
};

type InsertBlockOptions = {
  upsert?: boolean;
};

export const insertBlock = (
  editor: PlateEditor,
  type: string,
  options: InsertBlockOptions = {},
) => {
  const { upsert = false } = options;

  editor.tf.withoutNormalizing(() => {
    const block = editor.api.block();

    if (!block) return;

    const [currentNode, path] = block;
    const isCurrentBlockEmpty = editor.api.isEmpty(currentNode);
    const currentBlockType = getBlockType(currentNode);

    const isSameBlockType = type === currentBlockType;

    if (upsert && isCurrentBlockEmpty && isSameBlockType) {
      return;
    }

    if (type in insertBlockMap) {
      insertBlockMap[type]?.(editor, type);
    } else {
      editor.tf.insertNodes(editor.api.create.block({ type }), {
        at: PathApi.next(path),
        select: true,
      });
    }

    if (!isSameBlockType) {
      editor.tf.removeNodes({ previousEmptyBlock: true });
    }
  });
};

export const insertInlineElement = (editor: PlateEditor, type: string) => {
  if (insertInlineMap[type]) {
    insertInlineMap[type](editor, type);
  }
};

const setList = (
  editor: PlateEditor,
  type: string,
  entry: NodeEntry<TElement>,
) => {
  editor.tf.setNodes(
    editor.api.create.block({
      indent: 1,
      listStyleType: type,
    }),
    {
      at: entry[1],
    },
  );
};

const setFormBlock = (
  editor: PlateEditor,
  type: string,
  entry: NodeEntry<TElement>,
) => {
  const [node, path] = entry;
  const existingNode = node as Record<string, unknown>;
  if (!isFormQuestionType(type)) return;
  const baseType = fromPlateQuestionType(type);

  const existingValidation = existingNode.validation as
    | Record<string, unknown>
    | undefined;
  const validation = existingValidation
    ? { ...existingValidation, type: baseType }
    : { type: baseType, required: false };

  editor.tf.setNodes(
    {
      type,
      blockId: existingNode.blockId ?? crypto.randomUUID(),
      validation,
    },
    { at: path },
  );
};

const setBlockMap: Record<
  string,
  (editor: PlateEditor, type: string, entry: NodeEntry<TElement>) => void
> = {
  [KEYS.listTodo]: setList,
  [KEYS.ol]: setList,
  [KEYS.ul]: setList,
  [ACTION_THREE_COLUMNS]: (editor) => toggleColumnGroup(editor, { columns: 3 }),
  [KEYS.codeBlock]: (editor) => toggleCodeBlock(editor),
  ...Object.fromEntries(
    FORM_QUESTION_TYPES.map((type) => [type, setFormBlock]),
  ),
};

// Block types whose setBlockMap handler is an editor-wide toggle that
// ignores the per-node `entry` argument.  These must only be invoked once
// regardless of how many blocks are selected.
const TOGGLE_BLOCK_TYPES = new Set<string>([
  KEYS.codeBlock,
  ACTION_THREE_COLUMNS,
]);

export const setBlockType = (
  editor: PlateEditor,
  type: string,
  { at }: { at?: Path } = {},
) => {
  editor.tf.withoutNormalizing(() => {
    const cleanupEntry = (entry: NodeEntry<TElement>) => {
      const [node, path] = entry;

      if (node[KEYS.listType]) {
        editor.tf.unsetNodes([KEYS.listType, "indent"], { at: path });
      }
      if (
        isFormQuestionType(node.type as string) &&
        !isFormQuestionType(type)
      ) {
        editor.tf.unsetNodes(["blockId", "validation"], { at: path });
      }
    };

    const setEntry = (entry: NodeEntry<TElement>) => {
      cleanupEntry(entry);

      if (type in setBlockMap) {
        return setBlockMap[type]?.(editor, type, entry);
      }

      const [node] = entry;

      if (node.type !== type) {
        editor.tf.setNodes({ type }, { at: entry[1] });
      }
    };

    if (at) {
      const entry = editor.api.node<TElement>(at);

      if (entry) {
        setEntry(entry);

        return;
      }
    }

    const entries = editor.api.blocks({ mode: "lowest" });

    // Toggle-based types apply to the entire selection at once, so clean up
    // each entry but invoke the toggle handler only once.
    if (TOGGLE_BLOCK_TYPES.has(type) && type in setBlockMap) {
      for (const entry of entries) {
        cleanupEntry(entry);
      }
      const first = entries[0];

      if (first) {
        setBlockMap[type]?.(editor, type, first);
      }

      return;
    }

    entries.forEach((entry) => {
      setEntry(entry);
    });
  });
};

export const getBlockType = (block: TElement) => {
  if (block[KEYS.listType]) {
    if (block[KEYS.listType] === KEYS.ol) {
      return KEYS.ol;
    }
    if (block[KEYS.listType] === KEYS.listTodo) {
      return KEYS.listTodo;
    }
    return KEYS.ul;
  }

  return block.type;
};

// Strip the "form_" prefix to get the base question type for validation
function toBaseType(questionType: FormQuestionType): string {
  return fromPlateQuestionType(questionType);
}

const CHOICE_QUESTION_TYPES = new Set([
  toPlateQuestionType("radio"),
  toPlateQuestionType("checkbox"),
  toPlateQuestionType("dropdown"),
]);

function makeDefaultOptions() {
  return [
    { id: crypto.randomUUID(), label: "" },
    { id: crypto.randomUUID(), label: "" },
  ];
}

function getContainingFormQuestionPath(editor: PlateEditor): Path | undefined {
  const block = editor.api.block();
  if (!block) return undefined;

  const [, path] = block;
  for (let depth = path.length; depth > 0; depth--) {
    const candidatePath = path.slice(0, depth);
    const entry = editor.api.node<TElement>(candidatePath);
    if (
      entry &&
      typeof entry[0].type === "string" &&
      isFormQuestionType(entry[0].type)
    ) {
      return candidatePath;
    }
  }

  return undefined;
}

// Insert a form question block (container element with editable children)
export const insertFormQuestion = (
  editor: PlateEditor,
  questionType: FormQuestionType,
  options: {
    label?: string;
    validation?: Record<string, unknown>;
  } = {},
) => {
  const block = editor.api.block();
  const blockId = crypto.randomUUID();
  const label = options.label || "";
  const defaultValidation: Record<string, unknown> = {
    type: toBaseType(questionType),
    required: false,
  };
  if (CHOICE_QUESTION_TYPES.has(questionType)) {
    defaultValidation.options = makeDefaultOptions();
  }
  const validation = options.validation || defaultValidation;
  const questionNode = {
    type: questionType,
    blockId,
    validation,
    children: [{ type: "p", children: [{ text: label }] }],
  };

  editor.tf.withoutNormalizing(() => {
    if (!block) {
      editor.tf.insertNodes(questionNode, { select: true });
      return;
    }

    const [currentNode, path] = block;
    const containingQuestionPath = getContainingFormQuestionPath(editor);
    editor.tf.insertNodes(questionNode, {
      at: PathApi.next(containingQuestionPath ?? path),
      select: true,
    });

    if (editor.api.isEmpty(currentNode)) {
      editor.tf.removeNodes({ at: path });
    }
  });
};
