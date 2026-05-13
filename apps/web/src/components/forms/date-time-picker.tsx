import type { Control, FieldValues, Path } from "react-hook-form";
import { FormControl, FormField, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

interface DateTimePickerProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  disabled?: boolean;
  timezone?: string;
}

export function DateTimePicker<T extends FieldValues>({
  control,
  name,
  label,
  disabled = false,
}: DateTimePickerProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="datetime-local"
              disabled={disabled}
              {...field}
              value={typeof field.value === "string" ? field.value : ""}
            />
          </FormControl>
        </>
      )}
    />
  );
}
