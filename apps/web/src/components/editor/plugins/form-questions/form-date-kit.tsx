import { createPlatePlugin } from "platejs/react";
import { FormDateElement } from "@/components/ui/form-question-nodes/form-date-node";

export const FormDatePlugin = createPlatePlugin({
  key: "form_date",
  node: {
    isElement: true,
    isContainer: true,
    component: FormDateElement,
  },
});

export const FormDateKit = [FormDatePlugin];
