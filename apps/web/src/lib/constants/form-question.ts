import type { PlateQuestionType } from "@nexus-form/shared";

export const questionTypeLabels: Record<PlateQuestionType, string> = {
  form_short_text: "テキスト入力",
  form_long_text: "テキストエリア",
  form_radio: "ラジオボタン",
  form_checkbox: "チェックボックス",
  form_dropdown: "ドロップダウン",
  form_linear_scale: "スライダー",
  form_rating: "評価",
  form_choice_grid: "選択グリッド",
  form_checkbox_grid: "チェックグリッド",
  form_date: "日付入力",
  form_time: "時刻入力",
  form_section_separator: "セクション区切り",
};

export const EMPTY_OPTION_LABEL = "（空の選択肢）";
