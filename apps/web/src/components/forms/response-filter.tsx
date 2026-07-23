import {
  ArrowDown,
  ArrowUp,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ScorePreset = "ALL" | "HIGH" | "MID" | "LOW" | "CUSTOM";

export type ValidationFilterStatus =
  | "ALL"
  | "SUCCESS"
  | "FAILED"
  | "COMPLETED"
  | "PENDING"
  | "PROCESSING"
  | "MISSING";

export interface ResponseFilterProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  minScore?: number | null;
  maxScore?: number | null;
  onScoreRangeChange?: (min: number | null, max: number | null) => void;
  validationStatus?: ValidationFilterStatus | null;
  onValidationStatusChange?: (status: ValidationFilterStatus | null) => void;
  sort?: "submittedAt" | "updatedAt" | "uniquenessScore";
  onSortChange?: (
    sort: "submittedAt" | "updatedAt" | "uniquenessScore",
  ) => void;
  order?: "asc" | "desc";
  onOrderChange?: (order: "asc" | "desc") => void;
  onResetFilters?: () => void;
}

export function ResponseFilter({
  keyword,
  onKeywordChange,
  minScore = null,
  maxScore = null,
  onScoreRangeChange,
  validationStatus = null,
  onValidationStatusChange,
  sort = "submittedAt",
  onSortChange,
  order = "desc",
  onOrderChange,
  onResetFilters,
}: ResponseFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Active filter counting
  const activeFiltersCount =
    (keyword.trim() !== "" ? 1 : 0) +
    (minScore !== null || maxScore !== null ? 1 : 0) +
    (validationStatus && validationStatus !== "ALL" ? 1 : 0) +
    (sort !== "submittedAt" || order !== "desc" ? 1 : 0);

  const getScorePreset = (): ScorePreset => {
    if (minScore === 0.8 && maxScore === null) return "HIGH";
    if (minScore === 0.4 && maxScore === 0.8) return "MID";
    if (minScore === null && maxScore === 0.4) return "LOW";
    if (minScore === null && maxScore === null) return "ALL";
    return "CUSTOM";
  };

  const handleScorePresetChange = (preset: ScorePreset) => {
    if (!onScoreRangeChange) return;
    switch (preset) {
      case "HIGH":
        onScoreRangeChange(0.8, null);
        break;
      case "MID":
        onScoreRangeChange(0.4, 0.8);
        break;
      case "LOW":
        onScoreRangeChange(null, 0.4);
        break;
      case "ALL":
        onScoreRangeChange(null, null);
        break;
      case "CUSTOM":
        // leave minScore/maxScore as is
        break;
    }
  };

  return (
    <div className="space-y-3">
      {/* 検索・操作バー */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder="回答・回答者IDを検索"
            className="pl-9 pr-8"
            aria-label="回答検索"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => onKeywordChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="検索をクリア"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* フィルター切り替えボタン */}
        <Button
          type="button"
          variant={isOpen || activeFiltersCount > 0 ? "secondary" : "outline"}
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          className="gap-1.5"
          aria-expanded={isOpen}
          aria-label="フィルターパネル"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          フィルター
          {activeFiltersCount > 0 && (
            <Badge variant="default" className="ml-1 px-1.5 py-0 text-[10px]">
              {activeFiltersCount}
            </Badge>
          )}
        </Button>

        {/* リセットボタン */}
        {activeFiltersCount > 0 && onResetFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onResetFilters}
            className="gap-1 text-muted-foreground hover:text-foreground"
            aria-label="フィルターをリセット"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            リセット
          </Button>
        )}
      </div>

      {/* フィルター詳細パネル */}
      {isOpen && (
        <div className="rounded-lg border bg-muted/40 p-4 space-y-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* 検証結果フィルター */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                検証結果
              </span>
              <Select
                value={validationStatus ?? "ALL"}
                onValueChange={(val) =>
                  onValidationStatusChange?.(
                    val === "ALL" ? null : (val as ValidationFilterStatus),
                  )
                }
              >
                <SelectTrigger aria-label="検証結果フィルター">
                  <SelectValue placeholder="すべての検証結果" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">すべての検証結果</SelectItem>
                  <SelectItem value="SUCCESS">成功 (SUCCESS)</SelectItem>
                  <SelectItem value="FAILED">失敗 (FAILED)</SelectItem>
                  <SelectItem value="PENDING">待機中 (PENDING)</SelectItem>
                  <SelectItem value="PROCESSING">
                    処理中 (PROCESSING)
                  </SelectItem>
                  <SelectItem value="MISSING">参照欠落 (MISSING)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* スコア（ユニーク度）フィルター */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                ユニーク度スコア
              </span>
              <Select
                value={getScorePreset()}
                onValueChange={(val) =>
                  handleScorePresetChange(val as ScorePreset)
                }
              >
                <SelectTrigger aria-label="ユニーク度スコアフィルター">
                  <SelectValue placeholder="すべてのスコア" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">すべてのスコア</SelectItem>
                  <SelectItem value="HIGH">高ユニーク (&gt;= 0.8)</SelectItem>
                  <SelectItem value="MID">中ユニーク (0.4 ～ 0.8)</SelectItem>
                  <SelectItem value="LOW">低ユニーク (&lt;= 0.4)</SelectItem>
                  <SelectItem value="CUSTOM">カスタム指定</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ソート順 */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                並び替え
              </span>
              <div className="flex gap-1.5">
                <Select
                  value={sort}
                  onValueChange={(val) =>
                    onSortChange?.(
                      val as "submittedAt" | "updatedAt" | "uniquenessScore",
                    )
                  }
                >
                  <SelectTrigger aria-label="ソート項目" className="flex-1">
                    <SelectValue placeholder="ソート項目" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submittedAt">提出日時</SelectItem>
                    <SelectItem value="updatedAt">更新日時</SelectItem>
                    <SelectItem value="uniquenessScore">
                      ユニーク度スコア
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() =>
                    onOrderChange?.(order === "asc" ? "desc" : "asc")
                  }
                  aria-label={order === "asc" ? "昇順" : "降順"}
                  title={order === "asc" ? "昇順" : "降順"}
                >
                  {order === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* カスタムスコア指定時 */}
          {getScorePreset() === "CUSTOM" && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">スコア範囲:</span>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="1"
                placeholder="0.0"
                value={minScore ?? ""}
                onChange={(e) => {
                  const val = e.target.value
                    ? Number.parseFloat(e.target.value)
                    : null;
                  onScoreRangeChange?.(val, maxScore);
                }}
                className="h-8 w-20 text-xs"
                aria-label="最小スコア"
              />
              <span className="text-xs text-muted-foreground">～</span>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="1"
                placeholder="1.0"
                value={maxScore ?? ""}
                onChange={(e) => {
                  const val = e.target.value
                    ? Number.parseFloat(e.target.value)
                    : null;
                  onScoreRangeChange?.(minScore, val);
                }}
                className="h-8 w-20 text-xs"
                aria-label="最大スコア"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
