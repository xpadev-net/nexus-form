import { AlertTriangle, CheckCircle, Shield } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PrivacyPolicyViewer } from "./privacy-policy-viewer";

export interface PrivacyConsentProps {
  onConsentChange?: (consented: boolean) => void;
  required?: boolean;
  className?: string;
}

export const PrivacyConsent: FC<PrivacyConsentProps> = ({
  onConsentChange,
  required = true,
  className = "",
}) => {
  const [consented, setConsented] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    const savedConsent = localStorage.getItem("privacy-consent");
    if (savedConsent === "true") {
      setConsented(true);
    }
  }, []);

  useEffect(() => {
    onConsentChange?.(consented);
  }, [consented, onConsentChange]);

  const handleConsentChange = (checked: boolean) => {
    setConsented(checked);
    setHasInteracted(true);
    localStorage.setItem("privacy-consent", checked.toString());
  };

  const handleShowPolicy = () => {
    setShowPolicy(true);
  };

  if (showPolicy) {
    return (
      <PrivacyPolicyViewer
        onAccept={() => {
          setConsented(true);
          setHasInteracted(true);
          localStorage.setItem("privacy-consent", "true");
          setShowPolicy(false);
        }}
        onDecline={() => {
          setConsented(false);
          setHasInteracted(true);
          localStorage.setItem("privacy-consent", "false");
          setShowPolicy(false);
        }}
        className={className}
      />
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Shield className="h-5 w-5" />
          <span>プライバシー同意</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            本サービスでは、サービス提供のために個人情報を収集・利用します。
            詳細はプライバシーポリシーをご確認ください。
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="privacy-consent"
              checked={consented}
              onCheckedChange={handleConsentChange}
              disabled={!required}
            />
            <div className="space-y-1">
              <label
                htmlFor="privacy-consent"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {required
                  ? "プライバシーポリシーに同意します"
                  : "プライバシーポリシーに同意します（任意）"}
              </label>
              <p className="text-xs text-muted-foreground">
                同意いただけない場合、一部機能が制限される場合があります。
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleShowPolicy}
            className="w-full"
          >
            プライバシーポリシーを確認する
          </Button>
        </div>

        {hasInteracted && consented && (
          <div className="flex items-center space-x-2 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            <span>プライバシーポリシーに同意済みです</span>
          </div>
        )}

        {hasInteracted && !consented && required && (
          <div className="flex items-center space-x-2 text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            <span>プライバシーポリシーへの同意が必要です</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PrivacyConsent;
