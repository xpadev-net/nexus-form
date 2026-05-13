import { createPlatePlugin } from "platejs/react";
import { FormCheckboxGridElement } from "@/components/ui/form-question-nodes/form-checkbox-grid-node";

export const FormCheckboxGridPlugin = createPlatePlugin({
  key: "form_checkbox_grid",
  node: {
    isElement: true,
    isContainer: true,
    component: FormCheckboxGridElement,
  },
});

export const FormCheckboxGridKit = [FormCheckboxGridPlugin];
