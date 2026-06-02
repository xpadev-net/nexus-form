/**
 * FormAppearanceSchema ファクトリ
 *
 * theme のデフォルト色は brandConfig に依存するため、各 app がブランド設定を
 * パラメータとして渡す形式のファクトリ関数として提供する。
 */

import { z } from "zod";

const HexColorSchema = z
  .string()
  .regex(
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    "有効なHEXカラーコードを入力してください",
  );

export interface AppearanceBrandDefaults {
  primaryColor: string;
  accentColor: string;
}

export const FormLayoutSchema = z.object({
  width: z.enum(["full", "medium", "compact"]).default("medium"),
  alignment: z.enum(["left", "center"]).default("center"),
  spacing: z
    .enum(["compact", "comfortable", "spacious"])
    .default("comfortable"),
  show_progress_bar: z.boolean().default(true),
  progress_position: z.enum(["top", "bottom"]).default("top"),
  show_question_numbers: z.boolean().default(true),
});

export function createFormThemeSchema(defaults: AppearanceBrandDefaults) {
  return z.object({
    primary_color: HexColorSchema.default(defaults.primaryColor),
    accent_color: HexColorSchema.default(defaults.accentColor),
    background_color: HexColorSchema.default("#ffffff"),
    font_family: z.string().min(1).max(100).default("Inter"),
    brand_name: z.string().max(120).optional(),
    logo_url: z.string().url().optional(),
    cover_image_url: z.string().url().optional(),
  });
}

export function createFormAppearanceSchema(defaults: AppearanceBrandDefaults) {
  const FormThemeSchema = createFormThemeSchema(defaults);

  // safeParse({}) は各フィールドの .default() を適用する。
  // デフォルト値は brandConfig 由来のため、brandConfig.primaryColor / accentColor が
  // HexColorSchema（/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/）を満たさない場合のみ
  // safeParse が失敗する。その場合はハードコードされた安全な値にフォールバックする。
  const parseThemeDefault = (): z.infer<typeof FormThemeSchema> => {
    const result = FormThemeSchema.safeParse({});
    if (result.success) return result.data;
    return {
      primary_color: "#000000",
      accent_color: "#000000",
      background_color: "#ffffff",
      font_family: "Inter",
      brand_name: undefined,
      logo_url: undefined,
      cover_image_url: undefined,
    } satisfies z.infer<typeof FormThemeSchema>;
  };

  // FormLayoutSchema のデフォルト値はすべてリテラルのため safeParse({}) は常に成功するが、
  // parseThemeDefault と対称性を保つため同じパターンで記述する。
  const parseLayoutDefault = (): z.infer<typeof FormLayoutSchema> => {
    const result = FormLayoutSchema.safeParse({});
    if (result.success) return result.data;
    return {
      width: "medium",
      alignment: "center",
      spacing: "comfortable",
      show_progress_bar: true,
      progress_position: "top",
      show_question_numbers: true,
    };
  };

  return z
    .object({
      theme: FormThemeSchema.optional(),
      layout: FormLayoutSchema.optional(),
    })
    .transform((data) => ({
      theme: data.theme ?? parseThemeDefault(),
      layout: data.layout ?? parseLayoutDefault(),
    }));
}

export type FormTheme = z.infer<ReturnType<typeof createFormThemeSchema>>;
export type FormLayout = z.infer<typeof FormLayoutSchema>;
export type FormAppearance = z.infer<
  ReturnType<typeof createFormAppearanceSchema>
>;
