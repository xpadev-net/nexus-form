// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlateViewer } from "./plate-viewer";

describe("PlateViewer loading fallback", () => {
  it("renders a non-announced skeleton without persistent loading text", () => {
    const html = renderToStaticMarkup(<PlateViewer value="[]" />);

    expect(html).toContain('data-testid="plate-viewer-loading"');
    expect(html).not.toContain("読み込み中...");
    expect(html).not.toContain("aria-live");
  });
});
