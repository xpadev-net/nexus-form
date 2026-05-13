// 国際化準備のためのメッセージ定数
export const MESSAGES = {
  // スケジュール設定関連
  schedule: {
    title: "スケジュール設定",
    description: "フォームの公開・非公開を自動化できます",
    enableSchedule: "スケジュールを有効にする",
    openAt: "公開開始日時",
    closeAt: "公開終了日時",
    timezone: "タイムゾーン",
    selectDate: "日付を選択",
    selectTime: "時間を選択",
    save: "保存",
    cancel: "キャンセル",
    loading: "保存中...",
  },

  // エラーメッセージ
  errors: {
    saveFailed: "スケジュール設定の保存に失敗しました",
    timeout: "リクエストがタイムアウトしました。再度お試しください",
    noPermission: "権限がありません",
    formNotFound: "フォームが見つかりません",
    invalidData: "入力データに問題があります",
    serverError:
      "サーバーエラーが発生しました。しばらくしてから再度お試しください",
    dateRangeInvalid:
      "開始日時は終了日時より前で、かつ未来の日時（最大5年後まで）である必要があります。また、開始日時と終了日時の間隔は15分以上必要です",
    timezoneInvalid: "有効なタイムゾーンを選択してください",
  } as const,

  // 成功メッセージ
  success: {
    scheduleUpdated: "スケジュール設定が更新されました",
  },
} as const;

export type Messages = typeof MESSAGES;
