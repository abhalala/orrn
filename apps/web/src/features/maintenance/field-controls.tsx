import { useFieldControl } from "@orrn/ui/components/field";
import { TextArea, type TextAreaProps } from "@orrn/ui/components/input";
import { NativeSelect, type NativeSelectProps } from "@orrn/ui/components/native-select";

/** A select tied to its surrounding `Field` (label, hint, error), like `TextInput`; the kit's own is not. */
export function FieldSelect(props: NativeSelectProps) {
  const a11y = useFieldControl({ id: props.id, "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"] });
  return <NativeSelect {...props} {...a11y} />;
}

/** A text area tied to its surrounding `Field`; the kit's own is not. */
export function FieldTextArea(props: TextAreaProps) {
  const a11y = useFieldControl({ id: props.id, "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"] });
  return <TextArea {...props} {...a11y} />;
}
