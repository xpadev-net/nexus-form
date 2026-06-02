import { useParams } from "@tanstack/react-router";
import { PlateEditor } from "@/components/editor/plate-editor";
import { FormDeletionModal } from "@/components/forms/form-deletion-modal";
import { FormDuplicateModal } from "@/components/forms/form-duplicate-modal";
import { EditorHeaderSection } from "@/components/forms/form-editor-page/editor-header-section";
import { FormSettingsTab } from "@/components/forms/form-editor-page/form-settings-tab";
import { useFormEditorPageModel } from "@/components/forms/form-editor-page/use-form-editor-page-model";
import { FormNotFoundPage } from "@/components/forms/form-not-found-page";
import { FormResponsesContent } from "@/components/forms/form-responses-page";
import { FormSharingSection } from "@/components/forms/form-sharing-section";
import { FormValidationRulesPage } from "@/components/forms/form-validation-rules-page";
import { PlateConflictBanner } from "@/components/forms/plate-conflict-banner";
import { Tabs, TabsContent } from "@/components/ui/tabs";

export function FormEditorPage() {
  const { id } = useParams({ from: "/_authenticated/forms/$id/edit" });
  const model = useFormEditorPageModel(id);

  if (model.isFormLoading || model.isContentLoading) {
    return (
      <div
        className="rounded-lg border bg-card p-6"
        role="status"
        aria-live="polite"
      >
        読み込み中...
      </div>
    );
  }

  if (model.isNotFound) {
    return (
      <FormNotFoundPage
        description="このフォームは存在しないか、編集権限がありません。"
        homeActionLabel="フォーム一覧へ戻る"
        showHomeAction
      />
    );
  }

  if (model.isFormError || model.isContentError) {
    return (
      <section className="rounded-lg border bg-card p-6 text-destructive">
        フォームの読み込みに失敗しました。再読み込みしてください。
      </section>
    );
  }

  return (
    <Tabs
      value={model.activeTab}
      onValueChange={model.handleTabChange}
      className="gap-4"
    >
      <EditorHeaderSection
        formId={id}
        formTitle={model.formData?.title ?? "フォームエディタ"}
        formStatus={model.formStatus}
        hasFormData={Boolean(model.formData)}
        isSaving={model.isSaving}
        isTitleSaving={model.isTitlePending}
        publicId={model.formData?.publicId}
        titleSaveFailureCount={model.titleSaveFailureCount}
        onTitleBlur={model.formData ? model.updateTitle : undefined}
        onPublishStatusChange={model.handlePublishStatusChange}
        onResetSuccess={model.refetchContent}
      />

      <TabsContent value="editor" className="space-y-4">
        {model.conflictState && (
          <PlateConflictBanner
            conflicts={model.conflictState.result.conflicts}
            resolutions={model.conflictResolutions}
            onResolutionChange={model.setConflictResolutions}
            onResolve={model.resolveConflicts}
            onDismiss={model.dismissConflict}
            isMerging={model.isMerging}
          />
        )}
        <section className="rounded-lg border bg-card shadow-sm">
          <PlateEditor
            value={model.draftContent ?? model.plateContent}
            onChange={model.handleContentChange}
          />
        </section>
      </TabsContent>

      <FormSettingsTab
        formId={id}
        formTitle={model.formData?.title ?? "フォーム"}
        formDescription={model.formData?.description ?? undefined}
        plateContent={model.draftContent ?? model.plateContent}
        isArchived={model.formStatus === "ARCHIVED"}
        archiveLoading={model.isArchivePending}
        onArchive={model.archiveForm}
        onUnarchive={model.unarchiveForm}
        onDuplicate={() => model.setShowDuplicateModal(true)}
        onDelete={() => model.setShowDeleteModal(true)}
      />

      <TabsContent value="validation">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <FormValidationRulesPage
            formId={id}
            plateContent={model.plateContent}
          />
        </section>
      </TabsContent>

      <TabsContent value="sharing">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <FormSharingSection
            formId={id}
            plateContent={model.plateContent}
            publicId={model.formData?.publicId}
          />
        </section>
      </TabsContent>

      <TabsContent
        value="responses"
        forceMount
        hidden={model.activeTab !== "responses"}
        aria-hidden={model.activeTab !== "responses"}
      >
        {model.responsesEverActive ? (
          <FormResponsesContent formId={id} />
        ) : null}
      </TabsContent>

      <FormDeletionModal
        open={model.showDeleteModal}
        title={model.formData?.title}
        isDeleting={model.isDeletePending}
        onConfirm={model.deleteForm}
        onClose={() => model.setShowDeleteModal(false)}
      />
      <FormDuplicateModal
        open={model.showDuplicateModal}
        isDuplicating={model.isDuplicatePending}
        onConfirm={model.duplicateForm}
        onClose={() => model.setShowDuplicateModal(false)}
      />
    </Tabs>
  );
}
