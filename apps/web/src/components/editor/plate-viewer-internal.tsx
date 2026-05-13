import { Plate, usePlateEditor } from "platejs/react";
import { useEffect, useRef } from "react";
import { ViewerKit } from "@/components/editor/editor-kit";
import { Editor, EditorContainer } from "@/components/ui/editor";

type Props = {
  value: string;
};

function parseValue(strValue: string) {
  if (!strValue) return [];
  try {
    const parsed = JSON.parse(strValue);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

export function PlateViewerInternal({ value: strValue }: Props) {
  const lastValue = useRef(strValue);

  const editor = usePlateEditor({
    plugins: [...ViewerKit],
    value: parseValue(strValue),
  });

  // Sync external value changes into the viewer
  useEffect(() => {
    if (strValue !== lastValue.current) {
      lastValue.current = strValue;
      editor.tf.setValue(parseValue(strValue));
    }
  }, [strValue, editor]);

  return (
    <Plate editor={editor} readOnly>
      <EditorContainer>
        <Editor variant="fullWidth" />
      </EditorContainer>
    </Plate>
  );
}
