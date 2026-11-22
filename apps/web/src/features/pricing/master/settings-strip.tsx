import { METAL_SOURCES, type MetalSource } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { bpToPercent, daysOf, percentToBp } from "./rate-model";
import { FieldSelect } from "./ui";

export type PricingSettingsView = { metalSource: MetalSource; estimatedGstBp: number; quoteValidDays: number };

/**
 * The settings strip: which metal list the plant prices on, the estimated tax shown on a proforma invoice and
 * how many days a quote stays valid. People with `price.manage` edit them (they apply at once); everyone else reads them.
 */
export function SettingsStrip({ settings }: { settings: PricingSettingsView }) {
  const { t } = useT();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [metal, setMetal] = useState<MetalSource>(settings.metalSource);
  const [tax, setTax] = useState(bpToPercent(settings.estimatedGstBp));
  const [days, setDays] = useState(String(settings.quoteValidDays));
  const [tried, setTried] = useState(false);

  useEffect(() => {
    setMetal(settings.metalSource);
    setTax(bpToPercent(settings.estimatedGstBp));
    setDays(String(settings.quoteValidDays));
    setTried(false);
  }, [settings.metalSource, settings.estimatedGstBp, settings.quoteValidDays]);

  const update = useMutation(
    trpc.pricing.settings.update.mutationOptions({
      onSuccess: async () => {
        toast.success(t("price.master.settings.saved"));
        await queryClient.invalidateQueries(trpc.pricing.pathFilter());
      },
      onError: () => toast.error(t("price.master.settings.saveFailed")),
    }),
  );

  const taxBp = percentToBp(tax);
  const validDays = daysOf(days);
  const changed = metal !== settings.metalSource || taxBp !== settings.estimatedGstBp || validDays !== settings.quoteValidDays;
  const metalLabel = (m: MetalSource) => t(`price.master.settings.metalOptions.${m}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (update.isPending || taxBp === null || validDays === null) return;
    update.mutate({ metalSource: metal, estimatedGstBp: taxBp, quoteValidDays: validDays });
  };

  return (
    <Card data-testid="price-settings">
      <CardHeader>
        <CardTitle as="h2">{t("price.master.settings.title")}</CardTitle>
      </CardHeader>
      {can(me, "price.manage") ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("price.master.settings.metal")}>
              <FieldSelect value={metal} onChange={(e) => setMetal(e.currentTarget.value as MetalSource)}>
                {METAL_SOURCES.map((m) => (
                  <option key={m} value={m}>
                    {metalLabel(m)}
                  </option>
                ))}
              </FieldSelect>
            </Field>
            <Field label={t("price.master.settings.tax")} hint={t("price.master.settings.taxHint")} error={tried && taxBp === null ? t("price.master.settings.errors.tax") : undefined}>
              <TextInput value={tax} inputMode="decimal" autoComplete="off" onChangeText={setTax} />
            </Field>
            <Field label={t("price.master.settings.days")} error={tried && validDays === null ? t("price.master.settings.errors.days") : undefined}>
              <TextInput value={days} inputMode="numeric" autoComplete="off" onChangeText={setDays} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Can do="price.manage">
              <Button type="submit" loading={update.isPending} disabled={!changed}>
                {t("price.master.settings.save")}
              </Button>
            </Can>
            <p className="m-0 text-[14px] text-muted-foreground">{t("price.master.settings.hint")}</p>
          </div>
        </form>
      ) : (
        <dl className="m-0 grid gap-3 text-[15px] sm:grid-cols-3">
          <div>
            <dt className="text-[13px] text-muted-foreground">{t("price.master.settings.metal")}</dt>
            <dd className="m-0 font-medium">{metalLabel(settings.metalSource)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">{t("price.master.settings.tax")}</dt>
            <dd className="m-0 font-medium tabular-nums">{bpToPercent(settings.estimatedGstBp)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">{t("price.master.settings.days")}</dt>
            <dd className="m-0 font-medium tabular-nums">{settings.quoteValidDays}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
