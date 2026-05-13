import { brandConfig } from "@/lib/brand-config";

export function Footer() {
  const { termsUrl, privacyUrl, copyright } = brandConfig;
  const hasLegalLinks = termsUrl || privacyUrl;

  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col items-center justify-center space-y-2 text-sm text-muted-foreground">
          {hasLegalLinks && (
            <nav className="flex items-center space-x-4">
              {termsUrl && (
                <a
                  href={termsUrl}
                  className="hover:text-foreground transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  利用規約
                </a>
              )}
              {termsUrl && privacyUrl && <span className="text-border">|</span>}
              {privacyUrl && (
                <a
                  href={privacyUrl}
                  className="hover:text-foreground transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  プライバシーポリシー
                </a>
              )}
            </nav>
          )}
          {copyright && <p>{copyright}</p>}
        </div>
      </div>
    </footer>
  );
}
