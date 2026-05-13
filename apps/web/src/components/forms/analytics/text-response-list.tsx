import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale/ja";
import { ChevronDown, ChevronUp, SortAsc, SortDesc } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  DateResponse,
  TextResponseAnalytics,
  TimeResponse,
} from "@/types/api/analytics";

// 回答データの統合型
type ResponseData = TextResponseAnalytics | DateResponse | TimeResponse;

// ブロックタイプ
type BlockType = "short_text" | "long_text" | "date" | "time";

// ソート順
type SortOrder = "newest" | "oldest";

interface TextResponseListProps {
  responses: ResponseData[];
  blockTitle?: string;
  blockType: BlockType;
  maxDisplay?: number;
}

export function TextResponseList({
  responses,
  blockTitle,
  blockType,
  maxDisplay = 30,
}: TextResponseListProps) {
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [showAll, setShowAll] = useState(false);

  // 回答をソート
  const sortedResponses = useMemo(() => {
    const sorted = [...responses].sort((a, b) => {
      const dateA = new Date(a.submitted_at);
      const dateB = new Date(b.submitted_at);
      return sortOrder === "newest"
        ? dateB.getTime() - dateA.getTime()
        : dateA.getTime() - dateB.getTime();
    });
    return sorted;
  }, [responses, sortOrder]);

  // 表示する回答を決定
  const displayedResponses = useMemo(() => {
    if (showAll) {
      return sortedResponses;
    }
    return sortedResponses.slice(0, maxDisplay);
  }, [sortedResponses, showAll, maxDisplay]);

  // 回答内容をフォーマット
  const formatResponse = (response: ResponseData, type: BlockType): string => {
    switch (type) {
      case "short_text":
      case "long_text":
        return (response as TextResponseAnalytics).value;
      case "date": {
        const dateResponse = response as DateResponse;
        try {
          const date = parseISO(dateResponse.date);
          return format(date, "yyyy年M月d日", { locale: ja });
        } catch {
          return dateResponse.date;
        }
      }
      case "time": {
        const timeResponse = response as TimeResponse;
        return timeResponse.time;
      }
      default:
        return "";
    }
  };

  // 日時をフォーマット
  const formatDate = (dateString: string): string => {
    try {
      const date = parseISO(dateString);
      return format(date, "M月d日 HH:mm", { locale: ja });
    } catch {
      return dateString;
    }
  };

  // ソート順を切り替え
  const toggleSortOrder = () => {
    setSortOrder(sortOrder === "newest" ? "oldest" : "newest");
  };

  // 全て表示/一部表示を切り替え
  const toggleShowAll = () => {
    setShowAll(!showAll);
  };

  // エンプティステート
  if (responses.length === 0) {
    return (
      <div className="space-y-4">
        {blockTitle && (
          <h3 className="text-lg font-semibold text-foreground">
            {blockTitle}
          </h3>
        )}
        <Card className="p-8 text-center">
          <div className="text-muted-foreground">
            <p className="text-sm">まだ回答がありません</p>
            <p className="text-xs mt-1">回答が集まるとここに表示されます</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      {blockTitle && (
        <h3 className="text-lg font-semibold text-foreground">{blockTitle}</h3>
      )}

      {/* コントロールバー */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          全 {responses.length} 件の回答
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSortOrder}
            className="h-8 px-2"
          >
            {sortOrder === "newest" ? (
              <>
                <SortDesc className="h-3 w-3 mr-1" />
                新しい順
              </>
            ) : (
              <>
                <SortAsc className="h-3 w-3 mr-1" />
                古い順
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 回答リスト */}
      <ScrollArea className="h-96 w-full">
        <div className="space-y-2 pr-4">
          {displayedResponses.map((response, index) => (
            <Card
              key={response.response_id}
              className="p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded flex-shrink-0">
                      #{index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground break-words">
                        {formatResponse(response, blockType)}
                      </p>
                    </div>
                  </div>
                </div>
                <time className="text-xs text-muted-foreground flex-shrink-0">
                  {formatDate(response.submitted_at)}
                </time>
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>

      {/* さらに表示ボタン */}
      {responses.length > maxDisplay && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={toggleShowAll}
            className="flex items-center gap-2"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-4 w-4" />
                一部のみ表示
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                さらに表示 ({responses.length - maxDisplay}件)
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
