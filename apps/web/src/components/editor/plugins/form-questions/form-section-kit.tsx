import { createPlatePlugin } from "platejs/react";
import { FormSectionSeparatorElement } from "@/components/ui/form-question-nodes/form-section-separator-node";

export const FormSectionPlugin = createPlatePlugin({
  key: "form_section_separator",
  node: {
    isElement: true,
    isContainer: true,
    component: FormSectionSeparatorElement,
  },
});

export const FormSectionKit = [FormSectionPlugin];
