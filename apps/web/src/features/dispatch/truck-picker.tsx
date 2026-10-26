import { useT } from "@orrn/i18n";
import { Field } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/shared/utils/trpc";

/**
 * "Same truck as" (Q37 per_truck): a dispatch for another customer can join a truck that is still
 * being built. The truck's vehicle, driver and transporter come with it; each customer keeps its
 * own packing list.
 */
export function TruckPicker({ value, onChange }: { value: string; onChange(next: string): void }) {
  const { t } = useT();
  const draft = useQuery(trpc.dispatch.listDispatches.queryOptions({ status: "draft", limit: 50 }));
  const held = useQuery(trpc.dispatch.listDispatches.queryOptions({ status: "reserved", limit: 50 }));
  const open = [...(draft.data?.items ?? []), ...(held.data?.items ?? [])];
  return (
    <Field label={t("dispatch.truck.pick")}>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("dispatch.truck.pick")}>
        <option value="">{t("dispatch.truck.none")}</option>
        {open.map((d) => (
          <option key={d.id} value={d.id}>
            {t("dispatch.truck.option", { code: d.code, customer: d.customerName, vehicle: d.vehicleNo ?? t("dispatch.truck.noVehicle") })}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
