import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

type FormActionButtonProps = ComponentProps<typeof Button>;

export function FormActionButton(props: FormActionButtonProps) {
  return <Button size="sm" {...props} />;
}
