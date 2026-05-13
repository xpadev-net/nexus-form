/**
 * フィンガープリント収集に関するプライバシー注意書きコンポーネント
 */

import { ChevronDown, ChevronUp, Info, Shield } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface PrivacyNoticeProps {
  className?: string;
  showDetails?: boolean;
  onConsentChange?: (consented: boolean) => void;
}

export function PrivacyNotice({
  className,
  showDetails = false,
  onConsentChange,
}: PrivacyNoticeProps) {
  const [isOpen, setIsOpen] = useState(showDetails);
  const [isConsented, setIsConsented] = useState(false);

  const handleConsentChange = (consented: boolean) => {
    setIsConsented(consented);
    onConsentChange?.(consented);
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-600" />
          プライバシー保護について
        </CardTitle>
        <CardDescription>
          フィンガープリント収集に関する重要な情報をお読みください
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 基本情報 */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>重複検出のため</strong>
            、デバイスのフィンガープリントを収集します。
            このデータは暗号化されて保存され、30日間保持された後自動削除されます。
          </AlertDescription>
        </Alert>

        {/* 収集される情報の詳細 */}
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <span>収集される情報の詳細</span>
              {isOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-sm mb-2">収集される情報</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <Badge variant="outline">ブラウザ情報</Badge>
                  <Badge variant="outline">画面解像度</Badge>
                  <Badge variant="outline">タイムゾーン</Badge>
                  <Badge variant="outline">言語設定</Badge>
                  <Badge variant="outline">フォント情報</Badge>
                  <Badge variant="outline">プラグイン情報</Badge>
                  <Badge variant="outline">Canvas フィンガープリント</Badge>
                  <Badge variant="outline">WebGL 情報</Badge>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2">データの取り扱い</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• データは暗号化（SHA-256）されて保存されます</li>
                  <li>• 個人を特定できる情報は含まれません</li>
                  <li>• 第三者と共有されることはありません</li>
                  <li>• 30日間保持後、自動削除されます</li>
                  <li>• いつでも削除を要求できます</li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2">法的根拠</h4>
                <p className="text-sm text-muted-foreground">
                  個人情報保護法第15条第1項に基づき、重複検出という正当な目的のため、
                  必要最小限の情報を収集します。同意なく収集することはありません。
                </p>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2">あなたの権利</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• データの削除を要求する権利</li>
                  <li>• データの開示を要求する権利</li>
                  <li>• データの訂正を要求する権利</li>
                  <li>• 同意の撤回する権利</li>
                </ul>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* 同意チェックボックス */}
        <div className="border-t pt-4">
          <div className="flex items-start space-x-3">
            <input
              type="checkbox"
              id="privacy-consent"
              checked={isConsented}
              onChange={(e) => handleConsentChange(e.target.checked)}
              className="mt-1 rounded border-border focus:ring-blue-500"
            />
            <div className="flex-1">
              <label htmlFor="privacy-consent" className="text-sm">
                <span className="font-medium">
                  上記の内容を理解し、フィンガープリント収集に同意します
                </span>
                <br />
                <span className="text-muted-foreground/70 text-xs">
                  同意いただけない場合、重複検出機能は利用できません
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* 連絡先情報 */}
        <div className="text-xs text-muted-foreground/70 border-t pt-2">
          <p>
            プライバシーに関するご質問は、お問い合わせフォームよりご連絡ください。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
