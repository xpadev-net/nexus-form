import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Link2,
  Mail,
  MessageCircle,
  Save,
  Trash2,
  Webhook,
} from "lucide-react";
import { type FC, type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  formDiffQueryKey,
  formPostSubmitStructureQueryKey,
  unpublishedChangesQueryKey,
} from "@/hooks/forms/form-structure-query-keys";
import { client, rpc } from "@/lib/api";
import {
  type FormConfirmation,
  FormConfirmationSchema,
  type FormNotificationsTransport,
  FormNotificationsTransportSchema,
} from "@/types/validation/form";

interface FormPostSubmitSettingsProps {
  formId: string;
}

interface PostSubmitDraft {
  title: string;
  message: string;
  supplementalLinkLabel: string;
  supplementalLinkUrl: string;
  contactLabel: string;
  contactEmail: string;
  contactUrl: string;
  showResponseId: boolean;
  emailEnabled: boolean;
  emailRecipients: string;
  emailSubject: string;
  discordEnabled: boolean;
  discordWebhookUrl: string;
  discordHasWebhookUrl: boolean;
  discordMessageTemplate: string;
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookHasUrl: boolean;
  webhookSecret: string;
  webhookHasSecret: boolean;
  webhookTimeoutSeconds: number;
  webhookRetryAttempts: number;
}

const PostSubmitConfirmationBasePayloadSchema = FormConfirmationSchema.omit({
  show_response_summary: true,
  allow_edit_link: true,
});

const PostSubmitConfirmationPayloadSchema =
  PostSubmitConfirmationBasePayloadSchema.extend({
    supplemental_link:
      PostSubmitConfirmationBasePayloadSchema.shape.supplemental_link.nullable(),
    contact: PostSubmitConfirmationBasePayloadSchema.shape.contact.nullable(),
  });

interface PostSubmitPayload {
  confirmation: z.infer<typeof PostSubmitConfirmationPayloadSchema>;
  notifications: FormNotificationsTransport;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function splitRecipients(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((recipient) => recipient.trim())
    .filter((recipient) => recipient !== "");
}

function parseConfirmation(value: unknown): FormConfirmation {
  const result = FormConfirmationSchema.safeParse(value ?? {});
  return result.success ? result.data : FormConfirmationSchema.parse({});
}

function parseNotifications(value: unknown): FormNotificationsTransport {
  const result = FormNotificationsTransportSchema.safeParse(value ?? {});
  return result.success
    ? result.data
    : FormNotificationsTransportSchema.parse({});
}

function draftFromSettings(
  confirmation: FormConfirmation,
  notifications: FormNotificationsTransport,
): PostSubmitDraft {
  const email = notifications.on_submit.email;
  const discord = notifications.on_submit.discord;
  const webhook = notifications.on_submit.webhook;

  return {
    title: confirmation.title,
    message: confirmation.message,
    supplementalLinkLabel: confirmation.supplemental_link?.label ?? "",
    supplementalLinkUrl: confirmation.supplemental_link?.url ?? "",
    contactLabel: confirmation.contact?.label ?? "",
    contactEmail: confirmation.contact?.email ?? "",
    contactUrl: confirmation.contact?.url ?? "",
    showResponseId: confirmation.show_response_id,
    emailEnabled: email?.enabled ?? false,
    emailRecipients: email?.recipients?.join("\n") ?? "",
    emailSubject: email?.subject ?? "",
    discordEnabled: discord?.enabled ?? false,
    discordWebhookUrl: discord?.webhook_url ?? "",
    discordHasWebhookUrl: discord?.has_webhook_url ?? !!discord?.webhook_url,
    discordMessageTemplate: discord?.message_template ?? "",
    webhookEnabled: webhook?.enabled ?? false,
    webhookUrl: webhook?.url ?? "",
    webhookHasUrl: webhook?.has_url ?? !!webhook?.url,
    webhookSecret: "",
    webhookHasSecret: webhook?.has_secret ?? !!webhook?.secret,
    webhookTimeoutSeconds: webhook?.timeout_seconds ?? 30,
    webhookRetryAttempts: webhook?.retry_attempts ?? 3,
  };
}

function buildPostSubmitPayload(draft: PostSubmitDraft): PostSubmitPayload {
  const supplementalLabel = emptyToUndefined(draft.supplementalLinkLabel);
  const supplementalUrl = emptyToUndefined(draft.supplementalLinkUrl);
  const contactLabel = emptyToUndefined(draft.contactLabel);
  const contactEmail = emptyToUndefined(draft.contactEmail);
  const contactUrl = emptyToUndefined(draft.contactUrl);
  const discordWebhookUrl = emptyToUndefined(draft.discordWebhookUrl);
  const webhookUrl = emptyToUndefined(draft.webhookUrl);
  const webhookSecret = emptyToUndefined(draft.webhookSecret);

  const confirmation = PostSubmitConfirmationPayloadSchema.parse({
    title: draft.title.trim(),
    message: draft.message.trim(),
    supplemental_link:
      supplementalLabel || supplementalUrl
        ? { label: supplementalLabel, url: supplementalUrl }
        : null,
    contact:
      contactEmail || contactUrl
        ? { label: contactLabel, email: contactEmail, url: contactUrl }
        : null,
    show_response_id: draft.showResponseId,
  });

  const notifications = FormNotificationsTransportSchema.parse({
    on_submit: {
      email: {
        enabled: draft.emailEnabled,
        recipients: splitRecipients(draft.emailRecipients),
        subject: emptyToUndefined(draft.emailSubject),
      },
      discord: {
        enabled: draft.discordEnabled,
        webhook_url: discordWebhookUrl,
        has_webhook_url: draft.discordHasWebhookUrl && !discordWebhookUrl,
        message_template: emptyToUndefined(draft.discordMessageTemplate),
      },
      webhook: {
        enabled: draft.webhookEnabled,
        url: webhookUrl,
        has_url: draft.webhookHasUrl && !webhookUrl,
        secret: webhookSecret,
        has_secret: draft.webhookHasSecret && !webhookSecret,
        timeout_seconds: draft.webhookTimeoutSeconds,
        retry_attempts: draft.webhookRetryAttempts,
      },
    },
  });

  return { confirmation, notifications };
}

function validationMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "入力内容を確認してください";
  }
  return error instanceof Error ? error.message : "入力内容を確認してください";
}

/**
 * Renders creator-owned post-submit confirmation and notification settings.
 *
 * @param formId - Form identifier used to load and patch the form structure.
 * @returns Post-submit settings editor section.
 */
export const FormPostSubmitSettings: FC<FormPostSubmitSettingsProps> = ({
  formId,
}) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PostSubmitDraft>(() =>
    draftFromSettings(
      FormConfirmationSchema.parse({}),
      FormNotificationsTransportSchema.parse({}),
    ),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const structureQuery = useQuery({
    queryKey: formPostSubmitStructureQueryKey(formId),
    queryFn: () =>
      rpc(client.api.forms[":id"].structure.$get({ param: { id: formId } })),
    enabled: !!formId,
  });

  const savedDraft = useMemo(
    () =>
      draftFromSettings(
        parseConfirmation(structureQuery.data?.structure?.confirmation),
        parseNotifications(structureQuery.data?.structure?.notifications),
      ),
    [structureQuery.data],
  );

  useEffect(() => {
    if (isDirty) return;
    setDraft(savedDraft);
  }, [isDirty, savedDraft]);

  const updateDraft = <Key extends keyof PostSubmitDraft>(
    key: Key,
    value: PostSubmitDraft[Key],
  ) => {
    setIsDirty(true);
    setValidationError(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: PostSubmitDraft) => {
      const payload = buildPostSubmitPayload(nextDraft);
      return rpc(
        client.api.forms[":id"].structure["post-submit"].$patch({
          param: { id: formId },
          json: payload,
        }),
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: formPostSubmitStructureQueryKey(formId),
        }),
        queryClient.invalidateQueries({ queryKey: formDiffQueryKey(formId) }),
        queryClient.invalidateQueries({
          queryKey: unpublishedChangesQueryKey(formId),
        }),
      ]);
      setIsDirty(false);
      toast.success("送信後設定を保存しました");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "送信後設定の保存に失敗しました",
      );
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      buildPostSubmitPayload(draft);
    } catch (error) {
      setValidationError(validationMessage(error));
      return;
    }
    saveMutation.mutate(draft);
  };

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">送信後</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            完了メッセージ、補足リンク、問い合わせ先、作成者向け通知を設定します。
          </p>
        </div>
        <Button
          type="submit"
          form="form-post-submit-settings"
          disabled={saveMutation.isPending || !structureQuery.data}
          size="sm"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "保存中..." : "保存"}
        </Button>
      </div>

      <form
        id="form-post-submit-settings"
        className="space-y-6"
        onSubmit={handleSubmit}
      >
        {validationError ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {validationError}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="post-submit-title">完了タイトル</Label>
            <Input
              id="post-submit-title"
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
              placeholder="ご回答ありがとうございます"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="post-submit-message">完了メッセージ</Label>
            <Textarea
              id="post-submit-message"
              value={draft.message}
              onChange={(event) => updateDraft("message", event.target.value)}
              placeholder="回答を受け付けました。"
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-submit-link-label">補足リンク名</Label>
            <Input
              id="post-submit-link-label"
              value={draft.supplementalLinkLabel}
              onChange={(event) =>
                updateDraft("supplementalLinkLabel", event.target.value)
              }
              placeholder="次のステップ"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-submit-link-url">補足リンク URL</Label>
            <Input
              id="post-submit-link-url"
              type="url"
              value={draft.supplementalLinkUrl}
              onChange={(event) =>
                updateDraft("supplementalLinkUrl", event.target.value)
              }
              placeholder="https://example.com/next"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-submit-contact-label">問い合わせ先名</Label>
            <Input
              id="post-submit-contact-label"
              value={draft.contactLabel}
              onChange={(event) =>
                updateDraft("contactLabel", event.target.value)
              }
              placeholder="サポート窓口"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="post-submit-contact-email">
                問い合わせメール
              </Label>
              <Input
                id="post-submit-contact-email"
                type="email"
                value={draft.contactEmail}
                onChange={(event) =>
                  updateDraft("contactEmail", event.target.value)
                }
                placeholder="support@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-submit-contact-url">問い合わせ URL</Label>
              <Input
                id="post-submit-contact-url"
                type="url"
                value={draft.contactUrl}
                onChange={(event) =>
                  updateDraft("contactUrl", event.target.value)
                }
                placeholder="https://example.com/support"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <Switch
              id="post-submit-response-id-visible"
              aria-labelledby="post-submit-response-id-heading"
              checked={draft.showResponseId}
              onCheckedChange={(checked) =>
                updateDraft("showResponseId", checked)
              }
            />
            <Label
              id="post-submit-response-id-heading"
              htmlFor="post-submit-response-id-visible"
            >
              完了画面に回答 ID を表示する
            </Label>
          </div>
        </div>

        <div className="rounded-md bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          完了画面の表示設定は公開後の回答者画面に反映されます。通知送信は有効化された設定に基づいて処理されます。
        </div>

        <div className="space-y-5 border-t pt-5">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h3
              id="post-submit-email-heading"
              className="text-sm font-semibold"
            >
              メール通知
            </h3>
            <Switch
              id="post-submit-email-enabled"
              aria-labelledby="post-submit-email-heading"
              checked={draft.emailEnabled}
              onCheckedChange={(checked) =>
                updateDraft("emailEnabled", checked)
              }
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="post-submit-email-recipients">送信先</Label>
              <Textarea
                id="post-submit-email-recipients"
                value={draft.emailRecipients}
                onChange={(event) =>
                  updateDraft("emailRecipients", event.target.value)
                }
                placeholder="owner@example.com"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-submit-email-subject">件名</Label>
              <Input
                id="post-submit-email-subject"
                value={draft.emailSubject}
                onChange={(event) =>
                  updateDraft("emailSubject", event.target.value)
                }
                placeholder="新しいフォーム回答"
              />
            </div>
          </div>
        </div>

        <div className="space-y-5 border-t pt-5">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
            <h3
              id="post-submit-discord-heading"
              className="text-sm font-semibold"
            >
              Discord 通知
            </h3>
            <Switch
              id="post-submit-discord-enabled"
              aria-labelledby="post-submit-discord-heading"
              checked={draft.discordEnabled}
              onCheckedChange={(checked) =>
                updateDraft("discordEnabled", checked)
              }
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="post-submit-discord-webhook">
                  Discord Webhook URL
                </Label>
                {draft.discordHasWebhookUrl && !draft.discordWebhookUrl ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      updateDraft("discordHasWebhookUrl", false);
                      updateDraft("discordEnabled", false);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    保存済み URL を削除
                  </Button>
                ) : null}
              </div>
              <Input
                id="post-submit-discord-webhook"
                type="url"
                value={draft.discordWebhookUrl}
                onChange={(event) =>
                  updateDraft("discordWebhookUrl", event.target.value)
                }
                placeholder={
                  draft.discordHasWebhookUrl
                    ? "保存済み URL を保持"
                    : "https://discord.com/api/webhooks/..."
                }
              />
              {draft.discordHasWebhookUrl && !draft.discordWebhookUrl ? (
                <p className="text-xs text-muted-foreground">
                  保存済み URL
                  は表示されません。空欄のまま保存すると保持します。
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-submit-discord-template">
                メッセージテンプレート
              </Label>
              <Textarea
                id="post-submit-discord-template"
                value={draft.discordMessageTemplate}
                onChange={(event) =>
                  updateDraft("discordMessageTemplate", event.target.value)
                }
                placeholder="新しい回答が届きました"
                rows={3}
              />
            </div>
          </div>
        </div>

        <div className="space-y-5 border-t pt-5">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-muted-foreground" />
            <h3
              id="post-submit-webhook-heading"
              className="text-sm font-semibold"
            >
              Webhook 通知
            </h3>
            <Switch
              id="post-submit-webhook-enabled"
              aria-labelledby="post-submit-webhook-heading"
              checked={draft.webhookEnabled}
              onCheckedChange={(checked) =>
                updateDraft("webhookEnabled", checked)
              }
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="post-submit-webhook-url">Webhook URL</Label>
                {draft.webhookHasUrl && !draft.webhookUrl ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      updateDraft("webhookHasUrl", false);
                      updateDraft("webhookEnabled", false);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    保存済み URL を削除
                  </Button>
                ) : null}
              </div>
              <Input
                id="post-submit-webhook-url"
                type="url"
                value={draft.webhookUrl}
                onChange={(event) =>
                  updateDraft("webhookUrl", event.target.value)
                }
                placeholder={
                  draft.webhookHasUrl
                    ? "保存済み URL を保持"
                    : "https://zapier.com/..."
                }
              />
              {draft.webhookHasUrl && !draft.webhookUrl ? (
                <p className="text-xs text-muted-foreground">
                  保存済み URL
                  は表示されません。空欄のまま保存すると保持します。
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="post-submit-webhook-secret">
                  署名シークレット
                </Label>
                {draft.webhookHasSecret && !draft.webhookSecret ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => updateDraft("webhookHasSecret", false)}
                  >
                    <Trash2 className="h-4 w-4" />
                    保存済み secret を削除
                  </Button>
                ) : null}
              </div>
              <Input
                id="post-submit-webhook-secret"
                type="password"
                value={draft.webhookSecret}
                onChange={(event) =>
                  updateDraft("webhookSecret", event.target.value)
                }
                placeholder={
                  draft.webhookHasSecret
                    ? "保存済み secret を保持"
                    : "32 文字以上"
                }
              />
              {draft.webhookHasSecret && !draft.webhookSecret ? (
                <p className="text-xs text-muted-foreground">
                  保存済み secret
                  は表示されません。空欄のまま保存すると保持します。
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-submit-webhook-timeout">
                タイムアウト秒数
              </Label>
              <Input
                id="post-submit-webhook-timeout"
                type="number"
                min={1}
                max={60}
                value={draft.webhookTimeoutSeconds}
                onChange={(event) =>
                  updateDraft(
                    "webhookTimeoutSeconds",
                    Number(event.target.value),
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-submit-webhook-retries">リトライ回数</Label>
              <Input
                id="post-submit-webhook-retries"
                type="number"
                min={0}
                max={5}
                value={draft.webhookRetryAttempts}
                onChange={(event) =>
                  updateDraft(
                    "webhookRetryAttempts",
                    Number(event.target.value),
                  )
                }
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t pt-5 text-sm text-muted-foreground">
          <Link2 className="h-4 w-4" />
          保存済みの URL と secret
          は取得時にマスクされ、入力し直した場合のみ更新されます。
        </div>
      </form>
    </section>
  );
};
