import { createPlatePlugin } from "platejs/react";
import { FormShortTextElement } from "@/components/ui/form-question-nodes/form-short-text-node";

export const FormShortTextPlugin = createPlatePlugin({
  key: "form_short_text",
  node: {
    isElement: true,
    isContainer: true,
    component: FormShortTextElement,
  },
});

export const FormShortTextKit = [FormShortTextPlugin];
