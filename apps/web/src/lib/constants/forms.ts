/**
 * フォーム関連の定数定義
 */

// フォームナビゲーションアクション
export const FORM_NAV = {
  SUBMIT: "__submit__",
  NEXT: "__next__",
} as const;

export type FormNavAction = (typeof FORM_NAV)[keyof typeof FORM_NAV];

/**
 * 文字列がフォームナビゲーションアクションかどうかを判定
 */
export function isFormNavAction(value: string): value is FormNavAction {
  return value === FORM_NAV.SUBMIT || value === FORM_NAV.NEXT;
}
