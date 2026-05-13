import { createPlatePlugin } from "platejs/react";
import { FormDropdownElement } from "@/components/ui/form-question-nodes/form-dropdown-node";

export const FormDropdownPlugin = createPlatePlugin({
  key: "form_dropdown",
  node: {
    isElement: true,
    isContainer: true,
    component: FormDropdownElement,
  },
});

export const FormDropdownKit = [FormDropdownPlugin];
