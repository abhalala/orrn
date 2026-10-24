import { useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect, type NativeSelectProps } from "@orrn/ui/components/native-select";

/** The platform select, wired to its surrounding `Field` (label, hint, error) like `TextInput`. */
export function FieldSelect({ id, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest }: NativeSelectProps) {
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid });
  return <NativeSelect {...a11y} {...rest} />;
}
