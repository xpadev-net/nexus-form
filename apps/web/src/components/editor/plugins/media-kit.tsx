import { CaptionPlugin } from "@platejs/caption/react";
import {
  ImagePlugin,
  MediaEmbedPlugin,
  PlaceholderPlugin,
} from "@platejs/media/react";
import { KEYS } from "platejs";
import { MediaEmbedElement } from "@/components/ui/media-embed-node";
import { ImageElement } from "@/components/ui/media-image-node";
import { MediaPlaceholderElement } from "@/components/ui/placeholder-node";

export const MediaKit = [
  ImagePlugin.configure({
    options: { disableUploadInsert: true },
    render: {
      node: ImageElement,
    },
  }),
  MediaEmbedPlugin.withComponent(MediaEmbedElement),
  PlaceholderPlugin.configure({
    options: { disableEmptyPlaceholder: true },
    render: {
      node: MediaPlaceholderElement,
    },
  }),
  CaptionPlugin.configure({
    options: {
      query: { allow: [KEYS.img] },
    },
  }),
];
