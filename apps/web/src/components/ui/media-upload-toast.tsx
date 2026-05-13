import type { FC } from "react";

/**
 * MediaUploadToast provides upload progress notifications.
 *
 * In Plate.js v52, upload state is managed per-element via PlaceholderProvider.
 * This component is rendered as an afterEditable of PlaceholderPlugin and can
 * access editor-level upload state if needed.
 *
 * For now this is a minimal stub. Individual placeholder elements show their
 * own upload progress via MediaPlaceholderElement.
 */
export const MediaUploadToast: FC = () => {
  // Upload progress is handled inline by the MediaPlaceholderElement.
  // A global toast overlay can be added here if a centralized notification
  // experience is desired.
  return null;
};
