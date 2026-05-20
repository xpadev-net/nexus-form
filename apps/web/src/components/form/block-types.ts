import { BLOCK_TYPES as CANONICAL_BLOCK_TYPES } from "@nexus-form/shared";
import {
  BarChart3,
  Calendar,
  CheckSquare,
  ChevronDown,
  Circle,
  Clock,
  FileText,
  Grid3X3,
  Navigation,
  Star,
  Type,
} from "lucide-react";
import type { ComponentType } from "react";
import type { BlockType } from "@/types/domain/form-block";

type BlockTypeMetadata = {
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  category: "text" | "choice" | "scale" | "grid" | "date" | "layout" | "system";
};

const BLOCK_TYPE_METADATA: Record<BlockType, BlockTypeMetadata> = {
  short_text: {
    label: "短文入力",
    description: "短いテキストの入力",
    icon: Type,
    category: "text",
  },
  long_text: {
    label: "長文入力",
    description: "長いテキストの入力",
    icon: FileText,
    category: "text",
  },
  radio: {
    label: "ラジオボタン",
    description: "単一選択",
    icon: Circle,
    category: "choice",
  },
  checkbox: {
    label: "チェックボックス",
    description: "複数選択",
    icon: CheckSquare,
    category: "choice",
  },
  dropdown: {
    label: "プルダウン",
    description: "ドロップダウン選択",
    icon: ChevronDown,
    category: "choice",
  },
  linear_scale: {
    label: "均等目盛",
    description: "任意範囲のスケール評価",
    icon: BarChart3,
    category: "scale",
  },
  rating: {
    label: "評価",
    description: "星評価",
    icon: Star,
    category: "scale",
  },
  choice_grid: {
    label: "選択式グリッド",
    description: "行列形式の単一選択",
    icon: Grid3X3,
    category: "grid",
  },
  checkbox_grid: {
    label: "チェックボックスグリッド",
    description: "行列形式の複数選択",
    icon: Grid3X3,
    category: "grid",
  },
  date: {
    label: "日付",
    description: "日付選択",
    icon: Calendar,
    category: "date",
  },
  time: {
    label: "時刻",
    description: "時刻選択",
    icon: Clock,
    category: "date",
  },
  section_separator: {
    label: "セクション",
    description: "セクション区切りと遷移設定",
    icon: Navigation,
    category: "layout",
  },
};

// ブロックタイプの定義とアイコン
export const BLOCK_TYPES = CANONICAL_BLOCK_TYPES.map((type) => ({
  type,
  ...BLOCK_TYPE_METADATA[type],
}));

// 定数
export const DRAG_ACTIVATION_DISTANCE = 8;
