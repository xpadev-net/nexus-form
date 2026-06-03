import { ElementApi, type Path, type TElement } from "platejs";
import { createPlatePlugin, type PlateEditor } from "platejs/react";
import { isFormQuestionType } from "@/components/editor/plate-types";
import { FormCheckboxGridKit } from "./form-checkbox-grid-kit";
import { FormCheckboxKit } from "./form-checkbox-kit";
import { FormChoiceGridKit } from "./form-choice-grid-kit";
import { FormDateKit } from "./form-date-kit";
import { FormDropdownKit } from "./form-dropdown-kit";
import { FormLinearScaleKit } from "./form-linear-scale-kit";
import { FormLongTextKit } from "./form-long-text-kit";
import { FormRadioKit } from "./form-radio-kit";
import { FormRatingKit } from "./form-rating-kit";
import { FormSectionKit } from "./form-section-kit";
import { FormShortTextKit } from "./form-short-text-kit";
import { FormTimeKit } from "./form-time-kit";

function createEmptyParagraphNode() {
  return { type: "p", children: [{ text: "" }] };
}

function hasFormQuestionAncestor(editor: PlateEditor, path: Path): boolean {
  for (let depth = path.length - 1; depth > 0; depth--) {
    const entry = editor.api.node<TElement>(path.slice(0, depth));
    if (
      entry &&
      typeof entry[0].type === "string" &&
      isFormQuestionType(entry[0].type)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Ensures every form question element always has at least one paragraph child.
 * Without this, dragging the last child out of a form question would leave it
 * empty, violating Slate's invariant that element nodes must have children.
 */
const FormQuestionNormalizerPlugin = createPlatePlugin({
  key: "form_question_normalizer",
}).overrideEditor(({ editor, tf: { normalizeNode } }) => ({
  transforms: {
    normalizeNode(entry) {
      const [n, path] = entry;
      if (
        ElementApi.isElement(n) &&
        typeof n.type === "string" &&
        isFormQuestionType(n.type)
      ) {
        if (hasFormQuestionAncestor(editor, path)) {
          if (editor.dom.readOnly) {
            return normalizeNode(entry);
          }

          const replacement =
            n.children.length > 0 ? n.children : [createEmptyParagraphNode()];
          editor.tf.removeNodes({ at: path });
          editor.tf.insertNodes(replacement, { at: path });
          return;
        }

        if (n.children.length > 0) {
          return normalizeNode(entry);
        }

        editor.tf.insertNodes(createEmptyParagraphNode(), { at: [...path, 0] });
        return;
      }
      return normalizeNode(entry);
    },
  },
}));

export const FormQuestionKits = [
  ...FormShortTextKit,
  ...FormLongTextKit,
  ...FormRadioKit,
  ...FormCheckboxKit,
  ...FormDropdownKit,
  ...FormLinearScaleKit,
  ...FormRatingKit,
  ...FormChoiceGridKit,
  ...FormCheckboxGridKit,
  ...FormDateKit,
  ...FormTimeKit,
  ...FormSectionKit,
  FormQuestionNormalizerPlugin,
];
