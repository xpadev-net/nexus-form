// Deterministic color utilities for charts (OKLCH)

/**
 * djb2-based string hash producing 32-bit unsigned integer
 */
export function stringHash(input: string): number {
  let hash = 5381 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    // hash * 33 + charCode
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

export type ColorMode = "light" | "dark";

export function labelToOkLch(
  label: string,
  mode: ColorMode = "dark",
): { l: number; c: number; h: number } {
  const hash = stringHash(label);
  const h = ((hash % 360) + 360) % 360; // 0-359
  const t = hash / 0xffffffff; // 0-1

  const cBase = 0.12;
  const cVar = 0.1; // 0.12?0.22
  const c = cBase + cVar * t;

  const [lMin, lMax] = mode === "dark" ? [0.6, 0.78] : [0.52, 0.72];
  const l = lMin + (lMax - lMin) * t;

  return { l, c, h };
}

export function labelToCssColor(
  label: string,
  mode: ColorMode = "dark",
): string {
  const { l, c, h } = labelToOkLch(label, mode);
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(3)})`;
}
