import type { Value as PlateValue } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import { useEffect, useRef } from "react";
import { EditorKit } from "@/components/editor/editor-kit";
import { Editor, EditorContainer } from "@/components/ui/editor";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

function parseValue(strValue: string): PlateValue {
  if (!strValue) return [];
  try {
    const parsed = JSON.parse(strValue);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

export function PlateEditorInternal({
  value: strValue,
  onChange: onChangeValue,
}: Props) {
  const lastExternalValue = useRef(strValue);
  const lastInternalValue = useRef(strValue);

  const editor = usePlateEditor({
    plugins: [...EditorKit],
    value: parseValue(strValue),
  });

  // Sync external value changes into the editor
  useEffect(() => {
    if (strValue !== lastExternalValue.current) {
      lastExternalValue.current = strValue;

      // Only update if the change came from outside (not from our own onChange)
      if (strValue !== lastInternalValue.current) {
        const parsed = parseValue(strValue);
        editor.tf.setValue(parsed);
        lastInternalValue.current = strValue;
      }
    }
  }, [strValue, editor]);

  return (
    <Plate
      editor={editor}
      onChange={(v) => {
        const serialized = JSON.stringify(v.value);
        lastInternalValue.current = serialized;
        lastExternalValue.current = serialized;
        onChangeValue(serialized);
      }}
    >
      <EditorContainer className="min-h-[500px]">
        <Editor variant="fullWidth" />
      </EditorContainer>
    </Plate>
  );
}
