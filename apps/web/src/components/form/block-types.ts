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

// ブロックタイプの定義とアイコン
export const BLOCK_TYPES: Array<{
  type: BlockType;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  category: "text" | "choice" | "scale" | "grid" | "date" | "layout" | "system";
}> = [
  {
    type: "short_text",
    label: "短文入力",
    description: "短いテキストの入力",
    icon: Type,
    category: "text",
  },
  {
    type: "long_text",
    label: "長文入力",
    description: "長いテキストの入力",
    icon: FileText,
    category: "text",
  },
  {
    type: "radio",
    label: "ラジオボタン",
    description: "単一選択",
    icon: Circle,
    category: "choice",
  },
  {
    type: "checkbox",
    label: "チェックボックス",
    description: "複数選択",
    icon: CheckSquare,
    category: "choice",
  },
  {
    type: "dropdown",
    label: "プルダウン",
    description: "ドロップダウン選択",
    icon: ChevronDown,
    category: "choice",
  },
  {
    type: "linear_scale",
    label: "均等目盛",
    description: "任意範囲のスケール評価",
    icon: BarChart3,
    category: "scale",
  },
  {
    type: "rating",
    label: "評価",
    description: "星評価",
    icon: Star,
    category: "scale",
  },
  {
    type: "choice_grid",
    label: "選択式グリッド",
    description: "行列形式の単一選択",
    icon: Grid3X3,
    category: "grid",
  },
  {
    type: "checkbox_grid",
    label: "チェックボックスグリッド",
    description: "行列形式の複数選択",
    icon: Grid3X3,
    category: "grid",
  },
  {
    type: "date",
    label: "日付",
    description: "日付選択",
    icon: Calendar,
    category: "date",
  },
  {
    type: "time",
    label: "時刻",
    description: "時刻選択",
    icon: Clock,
    category: "date",
  },
  {
    type: "section_separator",
    label: "セクション",
    description: "セクション区切りと遷移設定",
    icon: Navigation,
    category: "layout",
  },
];

// 定数
export const DRAG_ACTIVATION_DISTANCE = 8;
