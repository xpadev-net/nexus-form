import { createPlatePlugin } from "platejs/react";
import { FormRadioElement } from "@/components/ui/form-question-nodes/form-radio-node";

export const FormRadioPlugin = createPlatePlugin({
  key: "form_radio",
  node: {
    isElement: true,
    isContainer: true,
    component: FormRadioElement,
  },
});

export const FormRadioKit = [FormRadioPlugin];
