import type { CSSProperties, FC, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  type FormAppearance,
  FormAppearanceSchema,
} from "@/types/validation/form";

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

export type FormAppearanceResolvedColors = {
  accentColor: string;
  accentForeground: string;
  borderColor: string;
  cardBackground: string;
  cardForeground: string;
  inputColor: string;
  mutedBackground: string;
  mutedForeground: string;
  pageBackground: string;
  pageForeground: string;
  primaryColor: string;
  primaryForeground: string;
};

export type FormAppearanceSurfaceStyle = CSSProperties & {
  "--accent": string;
  "--accent-foreground": string;
  "--background": string;
  "--border": string;
  "--card": string;
  "--card-foreground": string;
  "--form-accent-color": string;
  "--foreground": string;
  "--input": string;
  "--muted": string;
  "--muted-foreground": string;
  "--popover": string;
  "--popover-foreground": string;
  "--primary": string;
  "--primary-foreground": string;
  "--ring": string;
  "--secondary": string;
  "--secondary-foreground": string;
};

export function expandHexColor(hexColor: string): string | null {
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hexColor)) {
    return null;
  }
  if (hexColor.length === 7) return hexColor.toLowerCase();
  return `#${hexColor
    .slice(1)
    .split("")
    .map((char) => `${char}${char}`)
    .join("")}`.toLowerCase();
}

function hexToRgb(hexColor: string): RgbColor | null {
  if (hexColor === "black") {
    return { red: 0, green: 0, blue: 0 };
  }
  if (hexColor === "white") {
    return { red: 255, green: 255, blue: 255 };
  }
  const expanded = expandHexColor(hexColor);
  if (!expanded) return null;
  const value = Number.parseInt(expanded.slice(1), 16);
  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  };
}

function rgbToHex({ red, green, blue }: RgbColor): string {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function blendHexColor(
  baseColor: string,
  overlayColor: string,
  overlayWeight: number,
): string {
  const base = hexToRgb(baseColor);
  const overlay = hexToRgb(overlayColor);
  if (!base || !overlay) return baseColor;
  return rgbToHex({
    red: base.red * (1 - overlayWeight) + overlay.red * overlayWeight,
    green: base.green * (1 - overlayWeight) + overlay.green * overlayWeight,
    blue: base.blue * (1 - overlayWeight) + overlay.blue * overlayWeight,
  });
}

export function relativeLuminance(hexColor: string): number | null {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return null;
  const channels = [rgb.red, rgb.green, rgb.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const red = channels[0] ?? 0;
  const green = channels[1] ?? 0;
  const blue = channels[2] ?? 0;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(
  foreground: string,
  background: string,
): number | null {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) {
    return null;
  }
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastTextColor(hexColor: string): "black" | "white" {
  const luminance = relativeLuminance(hexColor);
  if (luminance === null) return "black";
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "black" : "white";
}

export function normalizeFormAppearance(
  appearance: FormAppearance | undefined,
): FormAppearance {
  return appearance ?? FormAppearanceSchema.parse({});
}

export function resolveFormAppearanceColors(
  appearance: FormAppearance,
): FormAppearanceResolvedColors {
  const { theme } = appearance;
  const pageBackground =
    expandHexColor(theme.background_color) ?? theme.background_color;
  const pageForeground = contrastTextColor(pageBackground);
  const cardBackground = blendHexColor(pageBackground, pageForeground, 0.08);
  const cardForeground = contrastTextColor(cardBackground);
  const borderColor = blendHexColor(pageBackground, pageForeground, 0.22);
  const mutedBackground = blendHexColor(pageBackground, pageForeground, 0.12);
  const mutedForeground = blendHexColor(pageForeground, pageBackground, 0.38);
  const inputColor = blendHexColor(pageBackground, pageForeground, 0.28);
  const primaryColor =
    expandHexColor(theme.primary_color) ?? theme.primary_color;
  const accentColor = expandHexColor(theme.accent_color) ?? theme.accent_color;

  return {
    accentColor,
    accentForeground: contrastTextColor(accentColor),
    borderColor,
    cardBackground,
    cardForeground,
    inputColor,
    mutedBackground,
    mutedForeground,
    pageBackground,
    pageForeground,
    primaryColor,
    primaryForeground: contrastTextColor(primaryColor),
  };
}

export function formAppearanceSurfaceStyle(
  appearance: FormAppearance,
): FormAppearanceSurfaceStyle {
  const colors = resolveFormAppearanceColors(appearance);
  return {
    "--accent": colors.accentColor,
    "--accent-foreground": colors.accentForeground,
    "--background": colors.pageBackground,
    "--border": colors.borderColor,
    "--card": colors.cardBackground,
    "--card-foreground": colors.cardForeground,
    "--form-accent-color": colors.accentColor,
    "--foreground": colors.pageForeground,
    "--input": colors.inputColor,
    "--muted": colors.mutedBackground,
    "--muted-foreground": colors.mutedForeground,
    "--popover": colors.cardBackground,
    "--popover-foreground": colors.cardForeground,
    "--primary": colors.primaryColor,
    "--primary-foreground": colors.primaryForeground,
    "--ring": colors.primaryColor,
    "--secondary": colors.mutedBackground,
    "--secondary-foreground": colors.pageForeground,
    backgroundColor: colors.pageBackground,
    color: colors.pageForeground,
    fontFamily: appearance.theme.font_family,
  };
}

export function formAppearanceContrastWarnings(
  appearance: FormAppearance,
): string[] {
  const colors = resolveFormAppearanceColors(appearance);
  const checks = [
    {
      label: "テーマ色",
      ratio: contrastRatio(colors.primaryColor, colors.cardBackground),
      minimum: 4.5,
    },
    {
      label: "アクセント色",
      ratio: contrastRatio(colors.accentColor, colors.cardBackground),
      minimum: 3,
    },
  ];

  return checks
    .filter((check) => check.ratio !== null && check.ratio < check.minimum)
    .map(
      (check) =>
        `${check.label}とフォームカード背景のコントラストが ${check.minimum}:1 未満です。`,
    );
}

interface FormAppearanceSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  appearance?: FormAppearance;
  children: ReactNode;
}

export const FormAppearanceSurface: FC<FormAppearanceSurfaceProps> = ({
  appearance: appearanceProp,
  children,
  className,
  style,
  ...props
}) => {
  const appearance = normalizeFormAppearance(appearanceProp);
  return (
    <div
      {...props}
      className={cn("bg-background text-foreground", className)}
      data-form-appearance-surface="true"
      style={{ ...formAppearanceSurfaceStyle(appearance), ...style }}
    >
      {children}
    </div>
  );
};
