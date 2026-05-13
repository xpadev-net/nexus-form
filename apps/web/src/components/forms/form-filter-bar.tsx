export const FORM_FILTER_STATUSES = [
  { value: "all", label: "すべて" },
  { value: "draft", label: "下書き" },
  { value: "published", label: "公開中" },
  { value: "unpublished", label: "非公開" },
  { value: "archived", label: "アーカイブ" },
] as const;

const FORM_FILTER_STATUS_VALUES = new Set<string>(
  FORM_FILTER_STATUSES.map((o) => o.value),
);

export type FormFilterStatus = (typeof FORM_FILTER_STATUSES)[number]["value"];

interface FormFilterBarProps {
  searchTerm: string;
  status: FormFilterStatus;
  onSearchTermChange: (value: string) => void;
  onStatusChange: (value: FormFilterStatus) => void;
}

export function FormFilterBar({
  searchTerm,
  status,
  onSearchTermChange,
  onStatusChange,
}: FormFilterBarProps) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row">
      <input
        type="search"
        value={searchTerm}
        onChange={(event) => onSearchTermChange(event.target.value)}
        placeholder="フォーム名で検索"
        aria-label="フォーム名検索"
        className="w-full rounded border bg-background px-3 py-2 text-sm sm:max-w-sm"
      />
      <select
        value={status}
        onChange={(event) =>
          onStatusChange(
            FORM_FILTER_STATUS_VALUES.has(event.target.value)
              ? (event.target.value as FormFilterStatus)
              : "all",
          )
        }
        aria-label="フォームステータス絞り込み"
        className="rounded border bg-background px-3 py-2 text-sm sm:w-40"
      >
        {FORM_FILTER_STATUSES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
