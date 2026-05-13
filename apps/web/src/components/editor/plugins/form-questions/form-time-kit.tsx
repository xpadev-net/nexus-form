import { createPlatePlugin } from "platejs/react";
import { FormTimeElement } from "@/components/ui/form-question-nodes/form-time-node";

export const FormTimePlugin = createPlatePlugin({
  key: "form_time",
  node: {
    isElement: true,
    isContainer: true,
    component: FormTimeElement,
  },
});

export const FormTimeKit = [FormTimePlugin];
