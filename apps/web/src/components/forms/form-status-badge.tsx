import { Badge } from "@/components/ui/badge";

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
  }
> = {
  DRAFT: { label: "下書き", variant: "outline" },
  PUBLISHED: { label: "公開中", variant: "default" },
  UNPUBLISHED: { label: "非公開", variant: "secondary" },
  ARCHIVED: { label: "アーカイブ", variant: "secondary" },
};

const DEFAULT_STATUS = { label: "下書き", variant: "outline" } as const;

interface FormStatusBadgeProps {
  status?: string;
}

export function FormStatusBadge({ status }: FormStatusBadgeProps) {
  const key = status?.toUpperCase() ?? "DRAFT";
  const config = STATUS_CONFIG[key] ?? DEFAULT_STATUS;

  return <Badge variant={config.variant}>{config.label}</Badge>;
}
