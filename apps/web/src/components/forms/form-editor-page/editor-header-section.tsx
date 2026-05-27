import { Link } from "@tanstack/react-router";
import { ExternalLink, Eye } from "lucide-react";
import type { FC } from "react";
import { EDITOR_TAB_DEFINITIONS } from "@/components/forms/form-editor-page/editor-tab-definitions";
import { FormHeader } from "@/components/forms/form-header";
import { FormPublishMenu } from "@/components/forms/form-publish-menu";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FormStatus } from "@/types/validation/shared";

export interface EditorHeaderSectionProps {
  formId: string;
  formTitle: string;
  formStatus: FormStatus;
  hasFormData: boolean;
  isSaving: boolean;
  isTitleSaving: boolean;
  publicId?: string | null;
  titleSaveFailureCount: number;
  onTitleBlur?: (title: string) => void;
  onPublishStatusChange: () => void;
  onResetSuccess: () => void;
}

export const EditorHeaderSection: FC<EditorHeaderSectionProps> = ({
  formId,
  formTitle,
  formStatus,
  hasFormData,
  isSaving,
  isTitleSaving,
  publicId,
  titleSaveFailureCount,
  onTitleBlur,
  onPublishStatusChange,
  onResetSuccess,
}) => {
  return (
    <section>
      <FormHeader
        title={formTitle}
        onTitleBlur={onTitleBlur}
        isTitleSaving={isTitleSaving}
        titleSaveFailureCount={titleSaveFailureCount}
        action={
          <div className="flex items-center gap-2">
            {hasFormData && <FormStatusBadge status={formStatus} />}
            {isSaving && (
              <span className="text-xs text-muted-foreground">保存中...</span>
            )}
            {publicId && (
              <Button variant="outline" size="sm" asChild>
                <Link
                  to="/forms/public/$publicId"
                  params={{ publicId }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  公開フォームを開く
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/forms/preview/$id"
                params={{ id: formId }}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Eye className="mr-1 h-3.5 w-3.5" />
                プレビュー
              </Link>
            </Button>
            {hasFormData && (
              <FormPublishMenu
                formId={formId}
                formStatus={formStatus}
                onStatusChange={onPublishStatusChange}
                onResetSuccess={onResetSuccess}
              />
            )}
          </div>
        }
      />

      <TabsList
        variant="line"
        aria-label="フォーム編集セクション"
        className="w-full border-b"
      >
        {EDITOR_TAB_DEFINITIONS.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger key={tab.key} value={tab.key} className="px-4">
              <Icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </section>
  );
};
