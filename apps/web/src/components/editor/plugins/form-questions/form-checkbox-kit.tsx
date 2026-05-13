import { createPlatePlugin } from "platejs/react";
import { FormCheckboxElement } from "@/components/ui/form-question-nodes/form-checkbox-node";

export const FormCheckboxPlugin = createPlatePlugin({
  key: "form_checkbox",
  node: {
    isElement: true,
    isContainer: true,
    component: FormCheckboxElement,
  },
});

export const FormCheckboxKit = [FormCheckboxPlugin];
