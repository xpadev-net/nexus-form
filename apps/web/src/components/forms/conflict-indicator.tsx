import { AlertTriangle, CheckCircle } from "lucide-react";
import { useReducer, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { ConflictItem } from "@/types/domain/form-block";

interface ConflictIndicatorProps {
  conflicts: ConflictItem[];
  blockId: string;
  category: string;
  onResolveConflict: (
    conflictId: string,
    resolution: ConflictResolution,
  ) => void;
  className?: string;
}

export type ConflictResolution =
  | { type: "use_local"; value: unknown }
  | { type: "use_remote"; value: unknown }
  | { type: "manual_merge"; value: unknown };

interface ConflictItemDisplayProps {
  conflict: ConflictItem;
  onResolve: (resolution: ConflictResolution) => void;
}

function getConflictKey(blockId: string, conflict: ConflictItem): string {
  return `${blockId}:${conflict.path}:${JSON.stringify({
    base: conflict.base,
    local: conflict.local,
    remote: conflict.remote,
  })}`;
}

function ConflictItemDisplay({
  conflict,
  onResolve,
}: ConflictItemDisplayProps) {
  const [isResolved, setIsResolved] = useState(false);
  const [selectedResolution, setSelectedResolution] =
    useState<ConflictResolution | null>(null);

  const handleResolve = (resolution: ConflictResolution) => {
    setSelectedResolution(resolution);
    setIsResolved(true);
    onResolve(resolution);
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "なし";
    if (typeof value === "string") return value;
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <Card
      className={cn(
        "border-l-4 border-l-orange-500",
        isResolved && "opacity-60",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-orange-700">
            フィールド: {conflict.path}
          </CardTitle>
          {isResolved && (
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              <CheckCircle className="h-3 w-3 mr-1" />
              解決済み
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* ベース（元の値） */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-muted-foreground rounded-full" />
              <span className="text-sm font-medium text-muted-foreground">
                元の値
              </span>
            </div>
            <div className="p-2 bg-muted rounded text-sm font-mono text-muted-foreground">
              {formatValue(conflict.base)}
            </div>
          </div>

          {/* ローカル（自分の変更） */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full" />
              <span className="text-sm font-medium text-blue-600">
                あなたの変更
              </span>
            </div>
            <div className="p-2 bg-blue-50 rounded text-sm font-mono text-blue-700">
              {formatValue(conflict.local)}
            </div>
            {!isResolved && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-blue-600 border-blue-200 hover:bg-blue-50"
                onClick={() =>
                  handleResolve({ type: "use_local", value: conflict.local })
                }
              >
                この変更を採用
              </Button>
            )}
          </div>

          {/* リモート（他のユーザーの変更） */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-red-500 rounded-full" />
              <span className="text-sm font-medium text-red-600">
                他のユーザーの変更
              </span>
            </div>
            <div className="p-2 bg-red-50 rounded text-sm font-mono text-red-700">
              {formatValue(conflict.remote)}
            </div>
            {!isResolved && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-red-600 border-red-200 hover:bg-red-50"
                onClick={() =>
                  handleResolve({ type: "use_remote", value: conflict.remote })
                }
              >
                この変更を採用
              </Button>
            )}
          </div>
        </div>

        {!isResolved && (
          <div className="pt-2">
            <Separator />
            <div className="pt-4">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  // 手動マージの場合は、現在のローカル値をそのまま使用
                  handleResolve({
                    type: "manual_merge",
                    value: conflict.local,
                  });
                }}
              >
                手動でマージ
              </Button>
            </div>
          </div>
        )}

        {isResolved && selectedResolution && (
          <div className="pt-2">
            <Separator />
            <div className="pt-2">
              <div className="flex items-center space-x-2 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span>
                  解決方法:{" "}
                  {selectedResolution.type === "use_local"
                    ? "あなたの変更を採用"
                    : selectedResolution.type === "use_remote"
                      ? "他のユーザーの変更を採用"
                      : "手動マージ"}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConflictIndicator({
  conflicts,
  blockId,
  category,
  onResolveConflict,
  className,
}: ConflictIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [resolvedConflicts, resolveConflict] = useReducer(
    (prev: Set<string>, conflictId: string) => new Set([...prev, conflictId]),
    new Set<string>(),
  );

  const handleResolveConflict = (
    conflictIndex: number,
    resolution: ConflictResolution,
  ) => {
    const conflictId = `${blockId}-${conflictIndex}`;
    resolveConflict(conflictId);
    onResolveConflict(conflictId, resolution);
  };

  const unresolvedConflicts = conflicts.filter(
    (_, index) => !resolvedConflicts.has(`${blockId}-${index}`),
  );

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Alert variant="destructive" className="border-orange-200 bg-orange-50">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>
            <strong>{conflicts.length}</strong> 件の競合が検出されました
          </span>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="ml-2">
                競合を解決
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center space-x-2">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                  <span>競合の解決</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  ブロック「{category}」で {conflicts.length}{" "}
                  件の競合が発生しています。
                  各競合について、どの変更を採用するか選択してください。
                </div>
                <div className="space-y-4">
                  {conflicts.map((conflict, index) => (
                    <ConflictItemDisplay
                      key={getConflictKey(blockId, conflict)}
                      conflict={conflict}
                      onResolve={(resolution) =>
                        handleResolveConflict(index, resolution)
                      }
                    />
                  ))}
                </div>
                {unresolvedConflicts.length === 0 && (
                  <div className="pt-4">
                    <Alert className="border-green-200 bg-green-50">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <AlertDescription className="text-green-700">
                        すべての競合が解決されました。
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </AlertDescription>
      </Alert>
    </div>
  );
}
