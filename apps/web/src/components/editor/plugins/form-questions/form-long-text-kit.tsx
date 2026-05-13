import { createPlatePlugin } from "platejs/react";
import { FormLongTextElement } from "@/components/ui/form-question-nodes/form-long-text-node";

export const FormLongTextPlugin = createPlatePlugin({
  key: "form_long_text",
  node: {
    isElement: true,
    isContainer: true,
    component: FormLongTextElement,
  },
});

export const FormLongTextKit = [FormLongTextPlugin];
