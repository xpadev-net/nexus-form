import { DiscordSignInButton } from "@/components/auth/discord-signin-button";
import { InvitationCodeForm } from "@/components/auth/invitation-code-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { brandConfig } from "@/lib/brand-config";

function LegalAgreement() {
  const { termsUrl, privacyUrl } = brandConfig;
  if (!termsUrl && !privacyUrl) return null;

  return (
    <p className="mt-3 text-xs text-muted-foreground">
      ログインすることで、
      {termsUrl && (
        <a
          href={termsUrl}
          className="underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          利用規約
        </a>
      )}
      {termsUrl && privacyUrl && "および"}
      {privacyUrl && (
        <a
          href={privacyUrl}
          className="underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          プライバシーポリシー
        </a>
      )}
      に同意したものとみなされます。
    </p>
  );
}

export function SignInSection() {
  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl font-semibold">
          Connect your Discord account
        </CardTitle>
        <CardDescription>
          We use Discord to verify your identity and manage workspace
          permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            By continuing you agree to share your Discord username, email, and
            guild memberships required for form permissions.
          </p>
          <p>You can revoke access at any time from your Discord settings.</p>
        </div>

        <div className="space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-medium">既存ユーザー</h3>
            <p className="text-sm text-muted-foreground">
              すでにアカウントをお持ちの場合はこちら
            </p>
          </div>
          <DiscordSignInButton className="w-full" />
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator className="w-full" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              または
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-medium">新規ユーザー</h3>
            <p className="text-sm text-muted-foreground">
              新規登録には招待コードが必要です
            </p>
          </div>
          <InvitationCodeForm />
        </div>

        <LegalAgreement />
      </CardContent>
    </Card>
  );
}
