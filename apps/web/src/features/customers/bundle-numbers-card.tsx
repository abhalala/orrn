import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import type { StoredCustomer } from "./customer-form";

const POLICIES = ["", "monthly", "fy", "lifelong"] as const;
type Choice = (typeof POLICIES)[number];

/**
 * How this customer's own bundle numbers run (FP-PK-07): the plant serial as it is, monthly (26J12),
 * every financial year (2026-27/12) or never reset (4086). A change applies to bundles packed from then
 * on; old bundles keep the numbers they have. The label and the packing list print it beside the serial.
 */
export function BundleNumbersCard({ customer }: { customer: StoredCustomer }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const current: Choice = customer.bundleNumberPolicy ?? "";
  const [value, setValue] = useState<Choice>(current);
  const update = useMutation(trpc.customer.update.mutationOptions());
  const label = (c: Choice) => t(c === "" ? "customers.bundleNumbers.none" : `customers.bundleNumbers.${c}`);

  const save = () =>
    update.mutate(
      {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        taxId: customer.taxId,
        notes: customer.notes,
        billingAddress: customer.billingAddress,
        shippingAddress: customer.shippingAddress,
        kgToleranceBp: customer.kgToleranceBp ?? null,
        bundleNumberPolicy: value === "" ? null : value,
      },
      {
        onSuccess: () => {
          toast.success(t("customers.bundleNumbers.saved"));
          void queryClient.invalidateQueries({ queryKey: trpc.customer.get.queryKey({ id: customer.id }) });
        },
        onError: (err) => toast.error(err.data?.code === "FORBIDDEN" ? t("errors.forbidden") : t("errors.generic")),
      },
    );

  return (
    <Card data-slot="bundle-numbers">
      <CardHeader>
        <CardTitle>{t("customers.bundleNumbers.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="m-0 text-[15px]" data-testid="bundle-number-policy">
          {label(current)}
        </p>
        <Can do="customer.update">
          <div className="flex min-w-0 flex-col gap-3 sm:max-w-[360px]">
            <Field label={t("customers.bundleNumbers.change")} hint={t("customers.bundleNumbers.changeHint")} id="bundle-number-policy">
              <NativeSelect id="bundle-number-policy" value={value} onChange={(e) => setValue(e.currentTarget.value as Choice)}>
                {POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button className="self-start" loading={update.isPending} disabled={value === current} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </Can>
      </CardContent>
    </Card>
  );
}
