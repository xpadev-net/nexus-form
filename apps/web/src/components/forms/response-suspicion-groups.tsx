import type {
  ResponseSuspicionGroupDetailResponse,
  ResponseSuspicionGroupsResponse,
} from "@nexus-form/api/src/types/domain/form-responses";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, RefreshCw } from "lucide-react";
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

function reasonLabel(reasonCode: string): string {
  if (reasonCode === "hard:session") return "同一セッション";
  if (reasonCode === "strong:telemetry:v6") return "IPv6一致";
  if (reasonCode === "strong:visitorId-with-device-family") {
    return "visitorId + 独立端末特徴";
  }
  if (reasonCode === "strong:respondentUuid-with-device") {
    return "回答者UUID + 端末特徴";
  }
  if (reasonCode === "strong:multiple-device-families") {
    return "複数端末特徴";
  }
  if (reasonCode === "support:visitorId") return "visitorId一致";
  if (reasonCode === "support:device") return "端末特徴一致";
  if (reasonCode === "support:telemetry:v4") return "IPv4一致";
  if (reasonCode === "support:userAgent") return "User-Agent一致";
  if (reasonCode === "support:respondentUuid") return "回答者UUID一致";
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
    onSuccess: async () => {
      toast.success("疑義グループの再計算を開始しました");
      await queryClient.invalidateQueries({
        queryKey: ["responseSuspicionGroups", formId],
      });
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

      {groups.length === 0 ? (
        <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
          疑義グループはありません。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-2">
            {groups.map((group) => (
              <button
                key={group.groupKey}
                type="button"
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
