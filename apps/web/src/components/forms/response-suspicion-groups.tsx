import type {
  ResponseSuspicionGroupDetailResponse,
  ResponseSuspicionGroupsResponse,
} from "@nexus-form/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { client, rpc } from "@/lib/api";
import { formatJapanLocaleDateTime } from "@/lib/formatters";

type ResponseSuspicionGroupsProps = {
  formId: string;
};

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

export function ResponseSuspicionGroups({
  formId,
}: ResponseSuspicionGroupsProps) {
  const queryClient = useQueryClient();
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["responseSuspicionGroups", formId],
    queryFn: (): Promise<ResponseSuspicionGroupsResponse> =>
      rpc(
        client.api.forms[":id"].responses["suspicion-groups"].$get({
          param: { id: formId },
        }),
      ),
  });

  const selectedGroup = useMemo(
    () =>
      groupsQuery.data?.groups.find(
        (group) => group.groupKey === selectedGroupKey,
      ) ?? null,
    [groupsQuery.data?.groups, selectedGroupKey],
  );

  const detailQuery = useQuery({
    queryKey: ["responseSuspicionGroupDetail", formId, selectedGroupKey],
    enabled: selectedGroupKey !== null,
    queryFn: (): Promise<ResponseSuspicionGroupDetailResponse> =>
      rpc(
        client.api.forms[":id"].responses["suspicion-groups"][":groupKey"].$get(
          {
            param: { id: formId, groupKey: selectedGroupKey ?? "" },
          },
        ),
      ),
  });

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

  if (groupsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        読み込み中...
      </div>
    );
  }

  if (groupsQuery.isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        疑義グループの取得に失敗しました
      </div>
    );
  }

  const run = groupsQuery.data?.run;
  const groups = groupsQuery.data?.groups ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {run?.completedAt
            ? `最終計算: ${formatJapanLocaleDateTime(run.completedAt)} / 母数 ${run.populationSize}件`
            : "まだ計算結果がありません"}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => recalculateMutation.mutate()}
          disabled={recalculateMutation.isPending}
        >
          {recalculateMutation.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          再計算
        </Button>
      </div>
      {run?.candidatePairLimitExceeded && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            衝突数が大きい候補バケットを除外した結果です。除外バケット数:{" "}
            {run.skippedCandidateBucketCount}
          </p>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
          疑義グループはありません。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-2">
            {groupsQuery.data?.hasNext && (
              <p className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                表示は先頭100グループまでです。全件確認が必要な場合は再計算結果の保存データを参照してください。
              </p>
            )}
            {groups.map((group) => (
              <button
                key={group.groupKey}
                type="button"
                aria-pressed={selectedGroupKey === group.groupKey}
                onClick={() => setSelectedGroupKey(group.groupKey)}
                className={[
                  "w-full rounded-md border p-3 text-left transition-colors",
                  selectedGroupKey === group.groupKey
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/40",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {group.responseCount}件の回答
                    </span>
                  </div>
                  <Badge variant="outline">
                    {confidenceLabel(group.technicalConfidence)}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {group.reasonCodes.slice(0, 4).map((reason) => (
                    <Badge key={reason} variant="secondary">
                      {reasonLabel(reason)}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  STRONG {group.strongLinkCount} / SUPPORT{" "}
                  {group.supportLinkCount}
                </p>
              </button>
            ))}
          </div>

          <div className="rounded-md border p-4">
            {!selectedGroupKey || !selectedGroup ? (
              <p className="text-sm text-muted-foreground">
                グループを選択してください。
              </p>
            ) : detailQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                詳細を読み込み中...
              </div>
            ) : detailQuery.isError ? (
              <p className="text-sm text-destructive">
                グループ詳細の取得に失敗しました
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">回答</h3>
                  {detailQuery.data?.hasNextMembers && (
                    <p className="mt-2 rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                      表示は先頭200回答までです。
                    </p>
                  )}
                  <div className="mt-2 space-y-2">
                    {(detailQuery.data?.members ?? []).map((member) => (
                      <div
                        key={member.responseId}
                        className="rounded-md border bg-muted/20 p-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs">
                            {member.responseId}
                          </span>
                          <Badge variant="outline">
                            {confidenceLabel(member.strongestStrength)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatJapanLocaleDateTime(member.submittedAt)} /{" "}
                          {member.respondentUuid}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold">リンク根拠</h3>
                  {detailQuery.data?.hasNextLinks && (
                    <p className="mt-2 rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                      表示は先頭1000リンクまでです。
                    </p>
                  )}
                  <div className="mt-2 space-y-2">
                    {(detailQuery.data?.links ?? []).map((link) => (
                      <div
                        key={`${link.responseIdA}:${link.responseIdB}`}
                        className="rounded-md border p-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {confidenceLabel(link.strength)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            device {link.deviceEvidence.toFixed(3)}
                          </span>
                          {link.v6Strong && (
                            <Badge variant="secondary">IPv6一致</Badge>
                          )}
                          {link.v4Support && (
                            <Badge variant="secondary">IPv4一致</Badge>
                          )}
                        </div>
                        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                          {link.responseIdA} / {link.responseIdB}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {link.reasonCodes.map((reason) => (
                            <Badge key={reason} variant="secondary">
                              {reasonLabel(reason)}
                            </Badge>
                          ))}
                          {link.familyContributions.map((family) => (
                            <Badge
                              key={`${link.responseIdA}:${link.responseIdB}:${family.family}`}
                              variant="outline"
                            >
                              {familyLabel(family.family)}{" "}
                              {family.score.toFixed(2)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
