import { createPlatePlugin } from "platejs/react";
import { FormLinearScaleElement } from "@/components/ui/form-question-nodes/form-linear-scale-node";

export const FormLinearScalePlugin = createPlatePlugin({
  key: "form_linear_scale",
  node: {
    isElement: true,
    isContainer: true,
    component: FormLinearScaleElement,
  },
});

export const FormLinearScaleKit = [FormLinearScalePlugin];
