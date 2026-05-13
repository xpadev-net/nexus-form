import { Share2 } from "lucide-react";
import { InvitationManager } from "@/components/forms/invitation-manager";
import { PermissionEditor } from "@/components/forms/permission-editor";
import { ShareLinkManager } from "@/components/forms/share-link-manager";

interface FormSharingSectionProps {
  formId: string;
}

export function FormSharingSection({ formId }: FormSharingSectionProps) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Share2 className="h-5 w-5" />
        共有設定
      </h2>
      <ShareLinkManager formId={formId} />
      <PermissionEditor formId={formId} />
      <InvitationManager formId={formId} />
    </section>
  );
}
