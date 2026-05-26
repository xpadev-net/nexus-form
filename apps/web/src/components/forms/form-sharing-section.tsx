import { Share2 } from "lucide-react";
import { FormPrefillGenerator } from "@/components/forms/form-prefill-generator";
import { InvitationManager } from "@/components/forms/invitation-manager";
import { PermissionEditor } from "@/components/forms/permission-editor";
import { ShareLinkManager } from "@/components/forms/share-link-manager";

interface FormSharingSectionProps {
  formId: string;
  plateContent: string;
  publicId?: string | null;
}

export function FormSharingSection({
  formId,
  plateContent,
  publicId,
}: FormSharingSectionProps) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Share2 className="h-5 w-5" />
        共有設定
      </h2>
      <ShareLinkManager formId={formId} />
      <PermissionEditor formId={formId} />
      <InvitationManager formId={formId} />
      {publicId && (
        <div className="rounded border p-4">
          <FormPrefillGenerator
            plateContent={plateContent}
            publicId={publicId}
          />
        </div>
      )}
    </section>
  );
}
