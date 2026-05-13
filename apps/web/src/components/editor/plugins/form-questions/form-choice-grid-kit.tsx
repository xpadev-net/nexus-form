import { createPlatePlugin } from "platejs/react";
import { FormChoiceGridElement } from "@/components/ui/form-question-nodes/form-choice-grid-node";

export const FormChoiceGridPlugin = createPlatePlugin({
  key: "form_choice_grid",
  node: {
    isElement: true,
    isContainer: true,
    component: FormChoiceGridElement,
  },
});

export const FormChoiceGridKit = [FormChoiceGridPlugin];
