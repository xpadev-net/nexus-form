export interface FingerprintComponentItem {
  componentName: string;
  componentValueHash: string;
  confidence?: number;
}

export interface CollectedFingerprint {
  fingerprintType: string;
}

export interface ExistingFingerprintItem {
  id: string;
  fingerprintType: string;
  componentName: string;
  componentValueHash: string;
}

export interface FingerprintStats {
  totalComponents: number;
  averageConfidence: number;
}

export interface CollectionState {
  hasCollected: boolean;
  progress: number;
  stage: string;
}

export type CollectionAction =
  | { type: "start" }
  | { type: "progress" }
  | { type: "complete" }
  | { type: "error" }
  | { type: "clear" };

export const initialCollectionState: CollectionState = {
  hasCollected: false,
  progress: 0,
  stage: "",
};

export const collectionReducer = (
  state: CollectionState,
  action: CollectionAction,
): CollectionState => {
  switch (action.type) {
    case "start":
      return { hasCollected: false, progress: 0, stage: "初期化中..." };
    case "progress": {
      if (state.progress >= 90) return state;
      const nextProgress = state.progress + 10;
      return {
        ...state,
        progress: nextProgress,
        stage:
          state.progress < 30
            ? "ブラウザ情報収集中..."
            : "フィンガープリント生成中...",
      };
    }
    case "complete":
      return { hasCollected: true, progress: 100, stage: "完了" };
    case "error":
      return { ...state, stage: "エラー" };
    case "clear":
      return { hasCollected: false, progress: 0, stage: "" };
  }
};

export function calculateFingerprintStats(
  components: FingerprintComponentItem[],
): FingerprintStats {
  const totalComponents = components.length;
  if (totalComponents === 0) {
    return { totalComponents, averageConfidence: 0 };
  }

  const averageConfidence =
    components.reduce(
      (sum, component) => sum + (component.confidence ?? 0),
      0,
    ) / totalComponents;

  return { totalComponents, averageConfidence };
}
