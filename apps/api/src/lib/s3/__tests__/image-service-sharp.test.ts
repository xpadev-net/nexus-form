import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { S3ImageService } from "../image-service";

describe("S3ImageService sharp processing", () => {
  it.each([
    { format: "webp", expectedFormat: "webp" },
    { format: "jpeg", expectedFormat: "jpeg" },
    { format: "png", expectedFormat: "png" },
  ] as const)("resizes and writes $format images", async (testCase) => {
    const source = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: { r: 220, g: 40, b: 40 },
      },
    })
      .png()
      .toBuffer();
    const service = new S3ImageService();

    const processed = await service.processImage(source, {
      format: testCase.format,
      maxWidth: 6,
      maxHeight: 6,
      quality: 80,
    });
    const metadata = await sharp(processed).metadata();

    expect(metadata.format).toBe(testCase.expectedFormat);
    expect(metadata.width).toBe(6);
    expect(metadata.height).toBe(4);
  });
});
