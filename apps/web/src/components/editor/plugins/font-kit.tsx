import {
  FontBackgroundColorPlugin,
  FontColorPlugin,
  FontFamilyPlugin,
  FontSizePlugin,
} from "@platejs/basic-styles/react";
import { KEYS } from "platejs";

export const FontKit = [
  FontColorPlugin.configure({
    inject: {
      targetPlugins: [KEYS.p],
      nodeProps: { defaultNodeValue: "black" },
    },
  }),
  FontBackgroundColorPlugin,
  FontSizePlugin,
  FontFamilyPlugin,
];
