import { Button } from "@/components/ui/button";

interface QuestionSorterItem {
  id: string;
  label: string;
}

interface QuestionSorterProps {
  items: QuestionSorterItem[];
  onMove?: (fromIndex: number, toIndex: number) => void;
}

export function QuestionSorter({ items, onMove }: QuestionSorterProps) {
  const handleMoveUp = (index: number) => {
    if (index === 0 || !onMove) return;
    onMove(index, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (index >= items.length - 1 || !onMove) return;
    onMove(index, index + 1);
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="flex items-center justify-between rounded border p-2"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true">⋮⋮</span>
            <span className="text-sm">{item.label}</span>
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => handleMoveUp(index)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => handleMoveDown(index)}
            >
              ↓
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
