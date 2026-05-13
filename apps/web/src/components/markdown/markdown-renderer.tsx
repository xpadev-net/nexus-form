import type { AnchorHTMLAttributes, FC, ImgHTMLAttributes } from "react";
import type { Options as MarkdownOptions } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Extract PluggableList type from react-markdown's Options
type PluggableList = NonNullable<MarkdownOptions["rehypePlugins"]>;

import { Card, CardContent } from "@/components/ui/card";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  showCard?: boolean;
  allowHtml?: boolean;
  allowImages?: boolean;
  imageBaseUrl?: string;
}

export const MarkdownRenderer: FC<MarkdownRendererProps> = ({
  content,
  className = "",
  showCard = false,
  allowHtml = false,
  allowImages = true,
  imageBaseUrl,
}) => {
  if (!content || content.trim() === "") {
    return (
      <div className={`text-muted-foreground italic ${className}`}>
        コンテンツがありません
      </div>
    );
  }

  // 画像URLを処理する関数
  const processImageUrl = (src: string): string => {
    if (!imageBaseUrl) return src;

    // 既に絶対URLの場合はそのまま返す
    if (src.startsWith("http://") || src.startsWith("https://")) {
      return src;
    }

    // 相対パスの場合はベースURLと結合
    const baseUrl = imageBaseUrl.endsWith("/")
      ? imageBaseUrl
      : `${imageBaseUrl}/`;
    const cleanSrc = src.startsWith("/") ? src.slice(1) : src;
    return `${baseUrl}${cleanSrc}`;
  };

  // カスタム画像コンポーネント
  const ImageComponent = ({
    src,
    alt,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement>) => {
    if (!allowImages) {
      return (
        <span className="text-muted-foreground italic">
          [画像は表示されません]
        </span>
      );
    }

    const processedSrc = processImageUrl(typeof src === "string" ? src : "");

    return (
      // biome-ignore lint/performance/noImgElement: Markdown renderer requires dynamic image URLs
      <img
        src={processedSrc}
        alt={alt}
        className="max-w-full h-auto rounded-md shadow-sm"
        loading="lazy"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = "none";
          const fallback = document.createElement("span");
          fallback.className = "text-muted-foreground italic";
          fallback.textContent = `[画像の読み込みに失敗しました: ${alt || "画像"}]`;
          target.parentNode?.insertBefore(fallback, target.nextSibling);
        }}
        {...props}
      />
    );
  };

  // カスタムリンクコンポーネント（セキュリティ強化）
  const LinkComponent = ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
    // 危険なプロトコルをブロック
    if (href && (href.startsWith("javascript:") || href.startsWith("data:"))) {
      return (
        <span className="text-muted-foreground italic">[リンクは無効です]</span>
      );
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-link hover:underline"
        {...props}
      >
        {children}
      </a>
    );
  };

  // プラグイン設定
  const plugins = [remarkGfm];
  const rehypePlugins: PluggableList = [];

  if (allowHtml) {
    rehypePlugins.push(rehypeRaw);
  }

  // XSS対策のためのサニタイズ設定
  const sanitizeOptions = {
    tagNames: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "del",
      "ins",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "img",
      "div",
      "span",
    ],
    attributes: {
      "*": ["className", "id"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      table: ["className"],
      th: ["scope", "colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    protocols: {
      href: ["http", "https", "mailto"],
      src: ["http", "https"],
    },
  };

  rehypePlugins.push([rehypeSanitize, sanitizeOptions]);

  const renderContent = () => (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={plugins}
        rehypePlugins={rehypePlugins}
        components={{
          img: ImageComponent,
          a: LinkComponent,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );

  if (showCard) {
    return (
      <Card className={className}>
        <CardContent className="p-4">{renderContent()}</CardContent>
      </Card>
    );
  }

  return (
    <div className={`markdown-content ${className}`}>{renderContent()}</div>
  );
};

export default MarkdownRenderer;
