import { useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect, type NativeSelectProps } from "@orrn/ui/components/native-select";

/** A select tied to its surrounding `Field` (label, hint, error), like `TextInput`. */
export function FieldSelect(props: NativeSelectProps) {
  const a11y = useFieldControl({ id: props.id, "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"] });
  return <NativeSelect {...props} {...a11y} />;
}
