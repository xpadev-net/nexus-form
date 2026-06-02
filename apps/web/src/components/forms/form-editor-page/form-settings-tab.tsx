import { Copy, Loader2, Trash2 } from "lucide-react";
import type { FC } from "react";
import { FormAccessControlSettings } from "@/components/forms/form-access-control-settings";
import { FormAppearanceSettings } from "@/components/forms/form-appearance-settings";
import { FormArchiveManager } from "@/components/forms/form-archive-manager";
import { FormPostSubmitSettings } from "@/components/forms/form-post-submit-settings";
import { FormPublicUrlSettings } from "@/components/forms/form-public-url-settings";
import { GoogleSheetsIntegration } from "@/components/forms/google-sheets-integration";
import { ScheduleManager } from "@/components/forms/schedule-manager";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

export interface FormSettingsTabProps {
  formId: string;
  formTitle: string;
  formDescription?: string;
  plateContent: string;
  isArchived: boolean;
  archiveLoading: boolean;
  duplicateLoading: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const FormSettingsTab: FC<FormSettingsTabProps> = ({
  formId,
  formTitle,
  formDescription,
  plateContent,
  isArchived,
  archiveLoading,
  duplicateLoading,
  onArchive,
  onUnarchive,
  onDuplicate,
  onDelete,
}) => {
  return (
    <TabsContent value="settings" className="space-y-4">
      <FormAppearanceSettings
        formId={formId}
        formTitle={formTitle}
        formDescription={formDescription}
        plateContent={plateContent}
      />

      <FormPostSubmitSettings formId={formId} />

      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <ScheduleManager formId={formId} />
      </section>

      <FormAccessControlSettings formId={formId} />

      <GoogleSheetsIntegration formId={formId} />

      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">フォーム管理</h2>
        <div className="flex flex-wrap gap-2">
          <FormArchiveManager
            isArchived={isArchived}
            isLoading={archiveLoading}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onDuplicate}
            disabled={duplicateLoading}
          >
            {duplicateLoading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            複製
          </Button>
        </div>
        <div className="mt-5 border-t pt-5">
          <h3 className="mb-2 text-sm font-semibold text-destructive">
            危険操作
          </h3>
          <div className="flex flex-wrap gap-2">
            <FormPublicUrlSettings formId={formId} />
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              削除
            </Button>
          </div>
        </div>
      </section>
    </TabsContent>
  );
};
