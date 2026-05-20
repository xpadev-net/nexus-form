import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatJapanLocaleDateTime } from "@/lib/formatters";
import { ResponseStatusBadge } from "./response-status-badge";

interface ResponseListItem {
  id: string;
  summary: string;
  status?: "valid" | "invalid" | "pending";
  submittedAt?: string;
}

interface ResponseListProps {
  items: ResponseListItem[];
  onSelect?: (id: string) => void;
}

export function ResponseList({ items, onSelect }: ResponseListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded border border-dashed p-8 text-muted-foreground">
        <Inbox className="h-8 w-8" />
        <p className="text-sm">回答はまだありません。</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id}>
          <Button
            type="button"
            variant="outline"
            className="flex w-full items-center justify-between gap-2 p-3 h-auto text-left hover:bg-muted/50"
            onClick={() => onSelect?.(item.id)}
          >
            <div className="flex flex-col gap-1 overflow-hidden">
              <span className="truncate text-sm">{item.summary}</span>
              {item.submittedAt ? (
                <span className="text-xs text-muted-foreground">
                  {formatJapanLocaleDateTime(item.submittedAt)}
                </span>
              ) : null}
            </div>
            {item.status ? <ResponseStatusBadge status={item.status} /> : null}
          </Button>
        </li>
      ))}
    </ul>
  );
}
