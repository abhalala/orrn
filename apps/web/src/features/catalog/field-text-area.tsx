import { useFieldControl } from "@orrn/ui/components/field";
import { TextArea, type TextAreaProps } from "@orrn/ui/components/input";
import { cn } from "@orrn/ui/lib/utils";

/** TextArea wired to its surrounding Field (label, hint, error), like TextInput. */
export function FieldTextArea(props: TextAreaProps) {
  const a11y = useFieldControl({ id: props.id, "aria-describedby": props["aria-describedby"] });
  return <TextArea {...props} {...a11y} className={cn("min-h-[88px] text-[15px] pointer-coarse:text-base", props.className)} />;
}
