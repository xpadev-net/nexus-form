import { useId } from "react";

interface FormTitleEditorProps {
  title: string;
  description: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}

export function FormTitleEditor({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
}: FormTitleEditorProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <>
      <label htmlFor={titleId} className="block text-sm font-medium">
        タイトル
      </label>
      <input
        id={titleId}
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        maxLength={255}
      />

      <label htmlFor={descriptionId} className="block text-sm font-medium">
        説明
      </label>
      <textarea
        id={descriptionId}
        value={description}
        onChange={(event) => onDescriptionChange(event.target.value)}
        className="w-full rounded-md border bg-background p-3 text-sm"
        rows={4}
      />
    </>
  );
}
