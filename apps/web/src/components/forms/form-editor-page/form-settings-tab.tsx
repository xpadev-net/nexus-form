import { Copy, Trash2 } from "lucide-react";
import type { FC } from "react";
import { FormAccessControlSettings } from "@/components/forms/form-access-control-settings";
import { FormArchiveManager } from "@/components/forms/form-archive-manager";
import { GoogleSheetsIntegration } from "@/components/forms/google-sheets-integration";
import { ScheduleManager } from "@/components/forms/schedule-manager";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

export interface FormSettingsTabProps {
  formId: string;
  isArchived: boolean;
  archiveLoading: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const FormSettingsTab: FC<FormSettingsTabProps> = ({
  formId,
  isArchived,
  archiveLoading,
  onArchive,
  onUnarchive,
  onDuplicate,
  onDelete,
}) => {
  return (
    <TabsContent value="settings" className="space-y-4">
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
          <Button variant="outline" size="sm" onClick={onDuplicate}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            複製
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            削除
          </Button>
        </div>
      </section>
    </TabsContent>
  );
};
