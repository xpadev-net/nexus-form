import type { ChangeEvent } from "react";

/**
 * チェックボックスの変更イベントハンドラー
 */
export type CheckboxChangeHandler = (checked: boolean) => void;

/**
 * ラジオボタンの変更イベントハンドラー
 */
export type RadioChangeHandler = (value: string) => void;

/**
 * ドロップダウンの変更イベントハンドラー
 */
export type DropdownChangeHandler = (value: string) => void;

/**
 * その他の選択肢の入力変更ハンドラー
 */
export type OtherInputChangeHandler = (
  event: ChangeEvent<HTMLInputElement>,
) => void;

/**
 * フォーカスアウトハンドラー
 */
export type BlurHandler = () => void;
