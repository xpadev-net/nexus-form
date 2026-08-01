import type {
  ResponseSuspicionGroupDetailResponse,
  ResponseSuspicionGroupsResponse,
} from "@nexus-form/shared";
import {
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AlertTriangle, Link2, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client, rpc } from "@/lib/api";
import { formatJapanLocaleDateTime } from "@/lib/formatters";

type ResponseSuspicionGroupsProps = {
  formId: string;
  onClose: () => void;
  /** Fired while hovering a group (all its members) or a single response
   * within the detail panel, `null` on hover-out, so the graph can dim
   * everything else. */
  onHoverResponses: (responseIds: string[] | null) => void;
  onSelectResponse: (responseId: string) => void;
};

type SuspicionGroupSummary = ResponseSuspicionGroupsResponse["groups"][number];

function confidenceLabel(strength: string): string {
  switch (strength) {
    case "HARD":
      return "確定的";
    case "STRONG":
      return "強い疑い";
    case "SUPPORT":
      return "補助";
    default:
      return "なし";
  }
}

const reasonLabels: Record<string, string> = {
  "hard:session": "同一セッション",
  "strong:telemetry:v6": "IPv6一致",
  "strong:visitorId-with-device-family": "visitorId + 独立端末特徴",
  "strong:respondentUuid-with-device": "回答者UUID + 端末特徴",
  "strong:multiple-device-families": "複数端末特徴",
  "support:visitorId": "visitorId一致",
  "support:device": "端末特徴一致",
  "support:telemetry:v4": "IPv4一致",
  "support:userAgent": "User-Agent一致",
  "support:respondentUuid": "回答者UUID一致",
};

function reasonLabel(reasonCode: string): string {
  const mapped = reasonLabels[reasonCode];
  if (mapped) return mapped;
  if (reasonCode.startsWith("match:")) return reasonCode.replace("match:", "");
  return reasonCode;
}

function familyLabel(family: string): string {
  switch (family) {
    case "composite":
      return "複合ID";
    case "rendering":
      return "描画";
    case "fonts":
      return "フォント";
    case "display":
      return "画面";
    case "system":
      return "システム";
    case "hardware":
      return "ハードウェア";
    case "audio":
      return "音声";
    default:
      return family;
  }
}

function useGroupDetailQuery(
  formId: string,
  groupKey: string | null,
): UseQueryResult<ResponseSuspicionGroupDetailResponse> {
  return useQuery({
    queryKey: ["responseSuspicionGroupDetail", formId, groupKey],
    enabled: groupKey !== null,
    queryFn: (): Promise<ResponseSuspicionGroupDetailResponse> =>
      rpc(
        client.api.forms[":id"].responses["suspicion-groups"][":groupKey"].$get(
          {
            param: { id: formId, groupKey: groupKey ?? "" },
          },
        ),
      ),
  });
}

type SuspicionGroupListItemProps = {
  formId: string;
  group: SuspicionGroupSummary;
  isSelected: boolean;
  onToggleSelect: () => void;
  onHoverGroup: () => void;
  onUnhoverGroup: () => void;
  onHoverResponses: (responseIds: string[] | null) => void;
  onSelectResponse: (responseId: string) => void;
};

/** One suspicion group's summary row plus, when selected, its member and
 * link-evidence detail — its own detail query only fires while selected. */
function SuspicionGroupListItem({
  formId,
  group,
  isSelected,
  onToggleSelect,
  onHoverGroup,
  onUnhoverGroup,
  onHoverResponses,
  onSelectResponse,
}: SuspicionGroupListItemProps) {
  const detailQuery = useGroupDetailQuery(
    formId,
    isSelected ? group.groupKey : null,
  );

  return (
    <div
      className={[
        "rounded-md border transition-colors",
        isSelected ? "border-primary bg-primary/5" : "",
      ].join(" ")}
    >
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={onToggleSelect}
        onMouseEnter={onHoverGroup}
        onMouseLeave={onUnhoverGroup}
        onFocus={onHoverGroup}
        onBlur={onUnhoverGroup}
        className={[
          "w-full p-2 text-left transition-colors",
          isSelected ? "" : "hover:bg-muted/40",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{group.responseCount}件の回答</span>
          <Badge variant="outline">
            {confidenceLabel(group.technicalConfidence)}
          </Badge>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {group.reasonCodes.slice(0, 4).map((reason) => (
            <Badge key={reason} variant="secondary" className="text-[10px]">
              {reasonLabel(reason)}
            </Badge>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          STRONG {group.strongLinkCount} / SUPPORT {group.supportLinkCount}
        </p>
      </button>

      {isSelected && (
        <div className="space-y-3 border-t p-2">
          {detailQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              詳細を読み込み中...
            </div>
          ) : detailQuery.isError ? (
            <p className="text-destructive">グループ詳細の取得に失敗しました</p>
          ) : (
            <>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground">
                  回答
                </h4>
                {detailQuery.data?.hasNextMembers && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    表示は先頭200回答までです。
                  </p>
                )}
                <div className="mt-1 space-y-1">
                  {(detailQuery.data?.members ?? []).map((member) => (
                    <button
                      key={member.responseId}
                      type="button"
                      className="block w-full rounded border bg-muted/20 p-1.5 text-left hover:bg-muted/40"
                      onClick={() => onSelectResponse(member.responseId)}
                      onMouseEnter={() => onHoverResponses([member.responseId])}
                      onMouseLeave={() => onHoverResponses(null)}
                      onFocus={() => onHoverResponses([member.responseId])}
                      onBlur={() => onHoverResponses(null)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-mono text-[10px]">
                          {member.responseId}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {confidenceLabel(member.strongestStrength)}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {formatJapanLocaleDateTime(member.submittedAt)} /{" "}
                        {member.respondentUuid}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground">
                  リンク根拠
                </h4>
                {detailQuery.data?.hasNextLinks && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    表示は先頭1000リンクまでです。
                  </p>
                )}
                <div className="mt-1 space-y-1">
                  {(detailQuery.data?.links ?? []).map((link) => (
                    <fieldset
                      key={`${link.responseIdA}:${link.responseIdB}`}
                      aria-label={`${link.responseIdA} / ${link.responseIdB}`}
                      className="rounded border p-1.5"
                      onMouseEnter={() =>
                        onHoverResponses([link.responseIdA, link.responseIdB])
                      }
                      onMouseLeave={() => onHoverResponses(null)}
                    >
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {confidenceLabel(link.strength)}
                        </Badge>
                        {link.v6Strong && (
                          <Badge variant="secondary" className="text-[10px]">
                            IPv6一致
                          </Badge>
                        )}
                        {link.v4Support && (
                          <Badge variant="secondary" className="text-[10px]">
                            IPv4一致
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                        {link.responseIdA} / {link.responseIdB}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {link.reasonCodes.map((reason) => (
                          <Badge
                            key={reason}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {reasonLabel(reason)}
                          </Badge>
                        ))}
                        {link.familyContributions.map((family) => (
                          <Badge
                            key={`${link.responseIdA}:${link.responseIdB}:${family.family}`}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {familyLabel(family.family)}{" "}
                            {family.score.toFixed(2)}
                          </Badge>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A draggable-free overlay panel (positioned over the relation graph by its
 * parent) listing suspicion groups. Hovering a group or a response inside it
 * reports the affected response ids via `onHoverResponses` so the graph can
 * highlight them; clicking a response opens its detail popup.
 */
export function ResponseSuspicionGroups({
  formId,
  onClose,
  onHoverResponses,
  onSelectResponse,
}: ResponseSuspicionGroupsProps) {
  const queryClient = useQueryClient();
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["responseSuspicionGroups", formId],
    queryFn: (): Promise<ResponseSuspicionGroupsResponse> =>
      rpc(
        client.api.forms[":id"].responses["suspicion-groups"].$get({
          param: { id: formId },
        }),
      ),
  });

  // Reuses the same query key as each item's own detail query when hovering
  // a group already opened, so react-query serves it from cache instead of
  // firing an extra request.
  const hoveredGroupDetailQuery = useGroupDetailQuery(formId, hoveredGroupKey);

  useEffect(() => {
    if (!hoveredGroupKey) return;
    const members = hoveredGroupDetailQuery.data?.members;
    if (!members) return;
    onHoverResponses(members.map((member) => member.responseId));
  }, [hoveredGroupKey, hoveredGroupDetailQuery.data, onHoverResponses]);

  const recalculateMutation = useMutation({
    mutationFn: () =>
      rpc(
        client.api.forms[":id"].responses["link-analysis"].recalculate.$post({
          param: { id: formId },
        }),
      ),
    onSuccess: async (result) => {
      if (result.enqueued) {
        toast.success("疑義グループの再計算を開始しました");
      } else {
        toast.info("疑義グループの再計算はすでに実行中です");
      }
      await queryClient.invalidateQueries({
        queryKey: ["responseSuspicionGroups", formId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["responseRelationGraph", formId],
      });
      if (selectedGroupKey !== null) {
        await queryClient.invalidateQueries({
          queryKey: ["responseSuspicionGroupDetail", formId, selectedGroupKey],
        });
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "再計算の開始に失敗しました",
      );
    },
  });

  const unhoverGroup = () => {
    setHoveredGroupKey(null);
    onHoverResponses(null);
  };

  const run = groupsQuery.data?.run;
  const groups = groupsQuery.data?.groups ?? [];

  return (
    <div className="absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-[420px] max-w-[calc(100%-1.5rem)] flex-col rounded-lg border bg-card shadow-xl">
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-t-lg border-b bg-muted px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Link2 className="h-4 w-4" />
          疑義グループ
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => recalculateMutation.mutate()}
            disabled={recalculateMutation.isPending}
          >
            {recalculateMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label="疑義グループを閉じる"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-sm">
        {groupsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            読み込み中...
          </div>
        ) : groupsQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            疑義グループの取得に失敗しました
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              {run?.completedAt
                ? `最終計算: ${formatJapanLocaleDateTime(run.completedAt)} / 母数 ${run.populationSize}件`
                : "まだ計算結果がありません"}
            </div>
            {run?.candidatePairLimitExceeded && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
                role="status"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  衝突数が大きい候補バケットを除外した結果です。除外バケット数:{" "}
                  {run.skippedCandidateBucketCount}
                </p>
              </div>
            )}

            {groups.length === 0 ? (
              <div className="rounded-md border bg-muted/20 p-3 text-muted-foreground">
                疑義グループはありません。
              </div>
            ) : (
              <div className="space-y-2">
                {groupsQuery.data?.hasNext && (
                  <p className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                    表示は先頭100グループまでです。
                  </p>
                )}
                {groups.map((group) => (
                  <SuspicionGroupListItem
                    key={group.groupKey}
                    formId={formId}
                    group={group}
                    isSelected={selectedGroupKey === group.groupKey}
                    onToggleSelect={() =>
                      setSelectedGroupKey(
                        selectedGroupKey === group.groupKey
                          ? null
                          : group.groupKey,
                      )
                    }
                    onHoverGroup={() => setHoveredGroupKey(group.groupKey)}
                    onUnhoverGroup={unhoverGroup}
                    onHoverResponses={onHoverResponses}
                    onSelectResponse={onSelectResponse}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
