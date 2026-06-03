import { EMPTY_OPTION_LABEL } from "@/lib/constants/form-question";

interface LabelLike {
  id: string;
  label: string;
}

export function getChoiceDisplayLabel(option: LabelLike): string {
  return option.label || EMPTY_OPTION_LABEL;
}

export function getGridItemDisplayLabel(item: LabelLike): string {
  return item.label || item.id;
}

export function getGridCellAccessibleName(
  row: LabelLike,
  column: LabelLike,
): string {
  return `${getGridItemDisplayLabel(row)}: ${getGridItemDisplayLabel(column)}`;
}
