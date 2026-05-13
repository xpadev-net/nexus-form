/**
 * メール送信サービス
 * 招待メールのテンプレート生成と送信
 * 本番環境では実際のメール送信サービス (SendGrid, AWS SES 等) と統合する
 */

import { brandConfig } from "../brand-config";
import { logError, logInfo, logWarn } from "../logger";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface InviteEmailData {
  email: string;
  role: string;
  message?: string;
  token: string;
  inviterName?: string;
}

const INVITE_BASE_URL = process.env.INVITE_BASE_URL || "http://localhost:3000";
const INVITE_ACCEPT_PATH = "/forms/invites";

function getInviteEmailSubject(): string {
  return `${brandConfig.appName} - アカウント招待のお知らせ`;
}

function getRoleLabel(role: string): string {
  switch (role) {
    case "ADMIN":
      return "管理者";
    case "CREATOR":
      return "作成者";
    case "EDITOR":
      return "編集者";
    case "VIEWER":
      return "閲覧者";
    default:
      return role;
  }
}

export function generateInviteEmailTemplate(
  data: InviteEmailData,
): EmailTemplate {
  const { email, role, message, token, inviterName } = data;
  const inviteUrl = `${INVITE_BASE_URL}${INVITE_ACCEPT_PATH}/${encodeURIComponent(token)}`;
  const roleLabel = getRoleLabel(role);
  const subject = getInviteEmailSubject();
  const { primaryColor, secondaryColor, appName } = brandConfig;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: ${primaryColor};">アカウント招待のお知らせ</h2>
    <p>こんにちは、</p>
    <p>${inviterName ? escapeHtml(inviterName) : "システム管理者"}から、${escapeHtml(appName)}への招待が送信されました。</p>
    <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: ${secondaryColor};">招待詳細</h3>
      <p><strong>メールアドレス:</strong> ${escapeHtml(email)}</p>
      <p><strong>ロール:</strong> ${escapeHtml(roleLabel)}</p>
      ${message ? `<p><strong>メッセージ:</strong> ${escapeHtml(message)}</p>` : ""}
    </div>
    <p>以下のボタンをクリックして、アカウントを有効化してください：</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${inviteUrl}" style="background-color: ${primaryColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
        アカウントを有効化
      </a>
    </div>
    <p>このリンクは7日間有効です。</p>
    <p>もしこの招待に心当たりがない場合は、このメールを無視してください。</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
    <p style="font-size: 12px; color: #6b7280;">このメールは自動送信されています。返信はできません。</p>
  </div>
</body>
</html>`;

  const text = `アカウント招待のお知らせ

こんにちは、

${inviterName ?? "システム管理者"}から、${appName}への招待が送信されました。

招待詳細:
- メールアドレス: ${email}
- ロール: ${roleLabel}
${message ? `- メッセージ: ${message}` : ""}

以下のリンクをクリックして、アカウントを有効化してください：
${inviteUrl}

このリンクは7日間有効です。

もしこの招待に心当たりがない場合は、このメールを無視してください。

---
このメールは自動送信されています。返信はできません。`;

  return { subject, html, text };
}

export async function sendInviteEmail(data: InviteEmailData): Promise<boolean> {
  try {
    const template = generateInviteEmailTemplate(data);

    if (process.env.NODE_ENV !== "production") {
      logInfo("[DEV] Invite email generated", "email", {
        to: data.email,
        role: data.role,
        subject: template.subject,
      });
      return true;
    }

    // 本番環境: メール送信サービスと統合
    // TODO: SendGrid / AWS SES / Nodemailer と統合
    logWarn(
      "Email sending not configured in production. Set up a mail provider.",
      "email",
      {},
    );
    return false;
  } catch (error) {
    logError("Failed to send invite email", "email", { error });
    return false;
  }
}
