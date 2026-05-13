import { ElementApi } from "platejs";
import { createPlatePlugin } from "platejs/react";
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
        isFormQuestionType(n.type) &&
        n.children.length === 0
      ) {
        editor.tf.insertNodes(
          { type: "p", children: [{ text: "" }] },
          { at: [...path, 0] },
        );
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
