import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Grid3X3, GripVertical, Plus, Trash2 } from "lucide-react";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompositionAwareInput } from "@/components/ui/composition-aware-input";
import { Label } from "@/components/ui/label";
import type {
  BlockByType,
  BlockType,
  GridColumn,
  GridRow,
  Option,
} from "@/types/domain/form-block";
import { DragHandleContext, SortableOptionItem } from "./sortable-option-item";

interface BlockOptionsEditorInternalProps<T extends BlockType> {
  question: BlockByType<T>;
  onValidationChange: (validation: BlockByType<T>["validation"]) => void;
  disabled?: boolean;
}

// ドラッグハンドル用のコンポーネント
const DragHandle = () => {
  const dragHandle = use(DragHandleContext);

  if (!dragHandle) {
    return <GripVertical className="h-4 w-4 text-muted-foreground" />;
  }

  return (
    <div
      ref={dragHandle.setActivatorNodeRef}
      {...dragHandle.attributes}
      {...dragHandle.listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4 text-muted-foreground" />
    </div>
  );
};

const BlockOptionsEditorInner = <T extends BlockType>({
  question,
  onValidationChange,
  disabled = false,
}: BlockOptionsEditorInternalProps<T>) => {
  const getOptionsTitle = (): string => {
    const titles: Partial<Record<BlockType, string>> = {
      radio: "選択肢の設定",
      checkbox: "選択肢の設定",
      dropdown: "選択肢の設定",
      choice_grid: "グリッドの設定",
      checkbox_grid: "グリッドの設定",
    };
    return titles[question.type] || "選択肢の設定";
  };

  const needsGridOptions = (type: BlockType): boolean => {
    return ["choice_grid", "checkbox_grid"].includes(type);
  };

  // 選択肢タイプの判定
  const isChoiceType = (
    type: BlockType,
  ): type is "radio" | "checkbox" | "dropdown" => {
    return type === "radio" || type === "checkbox" || type === "dropdown";
  };

  // 選択肢が存在するかチェック
  const hasChoiceOptions =
    isChoiceType(question.type) &&
    "options" in question.validation &&
    Array.isArray(question.validation.options) &&
    question.validation.options.length > 0;

  return (
    <div className="space-y-4">
      {(needsGridOptions(question.type) || hasChoiceOptions) && (
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-medium">{getOptionsTitle()}</h3>
          <Badge variant="outline">
            {needsGridOptions(question.type) ? "グリッド形式" : "選択肢形式"}
          </Badge>
        </div>
      )}

      {(question.type === "radio" ||
        question.type === "checkbox" ||
        question.type === "dropdown") && (
        <ChoiceOptionsRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
        />
      )}

      {(question.type === "choice_grid" ||
        question.type === "checkbox_grid") && (
        <GridOptionsRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
        />
      )}
    </div>
  );
};

interface BlockOptionsEditorProps<T extends BlockType> {
  block: BlockByType<T>;
  onValidationChange: (validation: BlockByType<T>["validation"]) => void;
  disabled?: boolean;
}

export const BlockOptionsEditor = <T extends BlockType>({
  block,
  onValidationChange,
  disabled = false,
}: BlockOptionsEditorProps<T>) => {
  return (
    <BlockOptionsEditorInner<T>
      question={block}
      onValidationChange={onValidationChange}
      disabled={disabled}
    />
  );
};

export default BlockOptionsEditor;

const ChoiceOptionsRenderer = <T extends "radio" | "checkbox" | "dropdown">({
  question,
  onValidationChange,
  disabled = false,
}: BlockOptionsEditorInternalProps<T>) => {
  const validation = question.validation;
  const options = validation.options || [];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
  );

  const handleOptionChange = (
    optionId: string,
    field: keyof Option,
    value: string,
  ) => {
    const newOptions = options.map((option: Option) =>
      option.id === optionId ? { ...option, [field]: value } : option,
    );
    onValidationChange({ ...validation, options: newOptions });
  };

  const handleAddOption = () => {
    if (disabled) return;
    const newOption: Option = {
      id: `option-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      label: "",
    };
    onValidationChange({
      ...validation,
      options: [...options, newOption],
    });
  };

  const handleRemoveOption = (optionId: string) => {
    if (disabled) return;
    const newOptions = options.filter(
      (option: Option) => option.id !== optionId,
    );
    onValidationChange({ ...validation, options: newOptions });
  };

  const handleOptionReorder = (event: DragEndEvent) => {
    if (disabled) return;
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = options.findIndex(
        (option: Option) => option.id === active.id,
      );
      const newIndex = options.findIndex(
        (option: Option) => option.id === over.id,
      );

      const newOptions = arrayMove(options, oldIndex, newIndex);
      onValidationChange({ ...validation, options: newOptions });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">選択肢</Label>
        <Button
          onClick={handleAddOption}
          size="sm"
          variant="outline"
          disabled={disabled}
        >
          <Plus className="h-4 w-4 mr-1" />
          選択肢を追加
        </Button>
      </div>

      {options.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>選択肢がありません</p>
          <p className="text-sm">
            「選択肢を追加」ボタンから選択肢を追加してください
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleOptionReorder}
        >
          <SortableContext
            items={options.map((option: Option) => option.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {options.map((option: Option, _index: number) => (
                <SortableOptionItem key={option.id} id={option.id}>
                  <div className="flex items-center gap-2 p-3 border rounded-lg">
                    <DragHandle />
                    <div className="flex-1">
                      <div className="space-y-1">
                        <Label
                          htmlFor={`option-label-${option.id}`}
                          className="text-xs"
                        >
                          選択肢名
                        </Label>
                        <CompositionAwareInput
                          id={`option-label-${option.id}`}
                          value={option.label}
                          onChange={(e) =>
                            handleOptionChange(
                              option.id,
                              "label",
                              e.target.value,
                            )
                          }
                          placeholder="選択肢の表示名"
                          disabled={disabled}
                        />
                      </div>
                    </div>
                    <Button
                      onClick={() => handleRemoveOption(option.id)}
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:text-red-700"
                      aria-label="選択肢を削除"
                      disabled={disabled}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </SortableOptionItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="text-xs text-muted-foreground">
        <p>
          • 選択肢名:
          ユーザーに表示されるテキスト、かつ回答として保存される値です
        </p>
      </div>
    </div>
  );
};

// ソート可能な列ヘッダーコンポーネント
const SortableColumnHeader = ({
  column,
  onLabelChange,
  onRemove,
  disabled,
}: {
  column: GridColumn;
  onLabelChange: (value: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={`border px-2 py-1 bg-muted/50 min-w-[150px] ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-1">
        <div
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <CompositionAwareInput
          value={column.label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="列ラベル"
          className="h-8 text-sm"
          disabled={disabled}
        />
        <Button
          onClick={onRemove}
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
          aria-label="列を削除"
          disabled={disabled}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </th>
  );
};

// ソート可能な行ヘッダーコンポーネント
const SortableRowHeader = ({
  row,
  onLabelChange,
  onRemove,
  disabled,
}: {
  row: GridRow;
  onLabelChange: (value: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <td
      ref={setNodeRef}
      style={style}
      className={`border px-2 py-1 bg-muted/50 min-w-[150px] ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-1">
        <div
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <CompositionAwareInput
          value={row.label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="行ラベル"
          className="h-8 text-sm"
          disabled={disabled}
        />
        <Button
          onClick={onRemove}
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
          aria-label="行を削除"
          disabled={disabled}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </td>
  );
};

const GridOptionsRenderer = <T extends "choice_grid" | "checkbox_grid">({
  question,
  onValidationChange,
  disabled = false,
}: BlockOptionsEditorInternalProps<T>) => {
  const validation = question.validation;
  const rows = validation.rows || [];
  const columns = validation.columns || [];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleRowChange = (
    rowId: string,
    field: keyof GridRow,
    value: string,
  ) => {
    if (disabled) return;
    const newRows = rows.map((row: GridRow) =>
      row.id === rowId ? { ...row, [field]: value } : row,
    );
    onValidationChange({ ...validation, rows: newRows });
  };

  const handleAddRow = () => {
    if (disabled) return;
    const newRow: GridRow = {
      id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      label: "",
    };
    onValidationChange({
      ...validation,
      rows: [...rows, newRow],
    });
  };

  const handleRemoveRow = (rowId: string) => {
    if (disabled) return;
    const newRows = rows.filter((row: GridRow) => row.id !== rowId);
    onValidationChange({ ...validation, rows: newRows });
  };

  const handleRowReorder = (event: DragEndEvent) => {
    if (disabled) return;
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = rows.findIndex((row: GridRow) => row.id === active.id);
      const newIndex = rows.findIndex((row: GridRow) => row.id === over.id);

      const newRows = arrayMove(rows, oldIndex, newIndex);
      onValidationChange({ ...validation, rows: newRows });
    }
  };

  const handleColumnChange = (
    columnId: string,
    field: keyof GridColumn,
    value: string,
  ) => {
    if (disabled) return;
    const newColumns = columns.map((column: GridColumn) =>
      column.id === columnId ? { ...column, [field]: value } : column,
    );
    onValidationChange({ ...validation, columns: newColumns });
  };

  const handleAddColumn = () => {
    if (disabled) return;
    const newColumn: GridColumn = {
      id: `column-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      label: "",
    };
    onValidationChange({
      ...validation,
      columns: [...columns, newColumn],
    });
  };

  const handleRemoveColumn = (columnId: string) => {
    if (disabled) return;
    const newColumns = columns.filter(
      (column: GridColumn) => column.id !== columnId,
    );
    onValidationChange({ ...validation, columns: newColumns });
  };

  const handleColumnReorder = (event: DragEndEvent) => {
    if (disabled) return;
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = columns.findIndex(
        (column: GridColumn) => column.id === active.id,
      );
      const newIndex = columns.findIndex(
        (column: GridColumn) => column.id === over.id,
      );

      const newColumns = arrayMove(columns, oldIndex, newIndex);
      onValidationChange({ ...validation, columns: newColumns });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Grid3X3 className="h-4 w-4" />
        <Label className="text-base font-medium">グリッドプレビュー</Label>
      </div>

      {/* グリッドテーブル */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => {
          // イベントから行か列かを判断して適切なハンドラーを呼ぶ
          const activeId = event.active.id as string;
          const isColumn = columns.some(
            (col: GridColumn) => col.id === activeId,
          );

          if (isColumn) {
            handleColumnReorder(event);
          } else {
            handleRowReorder(event);
          }
        }}
      >
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full border-collapse">
            <thead>
              <SortableContext
                items={columns.map((col: GridColumn) => col.id)}
                strategy={horizontalListSortingStrategy}
              >
                <tr>
                  <th className="border px-2 py-1 bg-muted min-w-[150px]" />
                  {columns.length > 0 ? (
                    <>
                      {columns.map((column: GridColumn) => (
                        <SortableColumnHeader
                          key={column.id}
                          column={column}
                          onLabelChange={(value) =>
                            handleColumnChange(column.id, "label", value)
                          }
                          onRemove={() => handleRemoveColumn(column.id)}
                          disabled={disabled}
                        />
                      ))}
                      <th className="border px-2 py-1 bg-muted min-w-[100px]">
                        <Button
                          onClick={handleAddColumn}
                          size="sm"
                          variant="outline"
                          className="h-8"
                          aria-label="列を追加"
                          disabled={disabled}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </th>
                    </>
                  ) : (
                    <th
                      colSpan={2}
                      className="border px-4 py-8 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-sm">列がありません</p>
                        <Button
                          onClick={handleAddColumn}
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          列を追加
                        </Button>
                      </div>
                    </th>
                  )}
                </tr>
              </SortableContext>
            </thead>
            <tbody>
              <SortableContext
                items={rows.map((row: GridRow) => row.id)}
                strategy={verticalListSortingStrategy}
              >
                {rows.map((row: GridRow) => (
                  <tr key={row.id}>
                    <SortableRowHeader
                      row={row}
                      onLabelChange={(value) =>
                        handleRowChange(row.id, "label", value)
                      }
                      onRemove={() => handleRemoveRow(row.id)}
                      disabled={disabled}
                    />
                    {columns.map((column: GridColumn) => (
                      <td
                        key={column.id}
                        className="border px-2 py-1 text-center text-muted-foreground"
                      >
                        —
                      </td>
                    ))}
                    <td className="border px-2 py-1" />
                  </tr>
                ))}
              </SortableContext>
              <tr>
                <td className="border px-2 py-1 bg-muted">
                  <Button
                    onClick={handleAddRow}
                    size="sm"
                    variant="outline"
                    className="h-8"
                    aria-label="行を追加"
                    disabled={disabled}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </td>
                {columns.map((column: GridColumn) => (
                  <td key={column.id} className="border px-2 py-1" />
                ))}
                {columns.length === 0 && <td className="border px-2 py-1" />}
              </tr>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 2}
                    className="border px-4 py-8 text-center text-muted-foreground"
                  >
                    <p className="text-sm">行がありません</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DndContext>

      <div className="text-xs text-muted-foreground">
        <p>• 行: 質問項目（例: 「サービス満足度」「価格満足度」）</p>
        <p>• 列: 選択肢（例: 「満足」「普通」「不満足」）</p>
        <p>• ドラッグハンドル（☰）をドラッグして順序を変更できます</p>
      </div>
    </div>
  );
};
