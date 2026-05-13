import { createPlatePlugin } from "platejs/react";
import { FormRatingElement } from "@/components/ui/form-question-nodes/form-rating-node";

export const FormRatingPlugin = createPlatePlugin({
  key: "form_rating",
  node: {
    isElement: true,
    isContainer: true,
    component: FormRatingElement,
  },
});

export const FormRatingKit = [FormRatingPlugin];
