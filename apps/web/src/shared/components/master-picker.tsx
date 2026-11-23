import { useT } from "@orrn/i18n";
import { useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { pickerId, pickerItems, pickerValue } from "@/shared/lib/master-options";
import { trpc } from "@/shared/utils/trpc";

export type MasterKind = "department" | "designation" | "packing_mode" | "die_category";

type Props = {
  kind: MasterKind;
  /** The stored id, or null when none is set. */
  value: string | null | undefined;
  onChange(id: string | null): void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

/**
 * A select over one plant master list (`masters.lists.list`): active entries, the current one even if
 * retired, and an empty choice that clears. The caller saves on change and gates it with `<Can>`.
 */
export function MasterPicker({ kind, value, onChange, disabled, id, "aria-label": ariaLabel, "data-testid": testId }: Props) {
  const { t } = useT();
  const list = useQuery({ ...trpc.masters.lists.list.queryOptions({ kind }), meta: INLINE_ERROR_META });
  const a11y = useFieldControl({ id });
  const items = pickerItems(list.data, value);
  return (
    <NativeSelect
      {...a11y}
      density="compact"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled || list.isPending}
      value={pickerValue(value)}
      onChange={(e) => onChange(pickerId(e.target.value))}
    >
      <option value="">{value ? t("adm.floor.none") : t("adm.floor.choose")}</option>
      {items.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </NativeSelect>
  );
}
