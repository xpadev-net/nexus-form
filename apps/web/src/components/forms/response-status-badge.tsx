import { Badge } from "@/components/ui/badge";

interface ResponseStatusBadgeProps {
  status: "valid" | "invalid" | "pending";
}

const STATUS_CONFIG: Record<
  ResponseStatusBadgeProps["status"],
  { label: string; variant: "default" | "destructive" | "secondary" }
> = {
  valid: { label: "有効", variant: "default" },
  invalid: { label: "無効", variant: "destructive" },
  pending: { label: "保留", variant: "secondary" },
};

export function ResponseStatusBadge({ status }: ResponseStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
