import { useFieldControl } from "@orrn/ui/components/field";
import { TextArea, type TextAreaProps } from "@orrn/ui/components/input";

/** `TextArea` that picks up its surrounding `Field` (label, hint, error); the kit's own does not. */
export function FieldTextArea(props: TextAreaProps) {
  const a11y = useFieldControl({ id: props.id, "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"] });
  return <TextArea {...props} {...a11y} />;
}
