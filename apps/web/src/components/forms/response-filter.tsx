import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ResponseFilterProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
}

export function ResponseFilter({
  keyword,
  onKeywordChange,
}: ResponseFilterProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={keyword}
        onChange={(event) => onKeywordChange(event.target.value)}
        placeholder="回答を検索"
        className="pl-9"
        aria-label="回答検索"
      />
    </div>
  );
}
