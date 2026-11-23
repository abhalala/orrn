import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PlantInput } from "@/shared/components/plant-input";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { MASS_KG, canonicalToDraft } from "@/shared/lib/plant-input";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useDevInvalidate } from "./hooks";
import { bpToPercentText, heartbeatFrom, minWeightG, percentTextToBp } from "./model";
import { Block, DevErrorNote } from "./ui";

/** The weigh tolerance (percent on screen, basis points stored), the smallest allowed difference and the heartbeat. */
export function SettingsTab() {
  const { t } = useT();
  const fmt = useFmt();
  const invalidate = useDevInvalidate();
  const q = useQuery({ ...trpc.devices.settings.get.queryOptions(), meta: INLINE_ERROR_META });
  const [pct, setPct] = useState("");
  const [minKg, setMinKg] = useState("");
  const [beat, setBeat] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setPct(bpToPercentText(q.data.weighToleranceBp));
    setMinKg(canonicalToDraft(MASS_KG, q.data.weighToleranceMinG));
    setBeat(String(q.data.heartbeatSec));
  }, [q.data?.weighToleranceBp, q.data?.weighToleranceMinG, q.data?.heartbeatSec]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation(
    trpc.devices.settings.update.mutationOptions({
      onSuccess: async () => {
        toast.success(t("dev3.saved"));
        await invalidate();
      },
    }),
  );
  if (showsQueryError(q)) {
    return <EmptyState title={t("dev3.loadFailed")} action={<Button variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>} />;
  }
  if (!q.data) return null;
  const s = q.data;
  const bp = percentTextToBp(pct);
  const minG = minWeightG(minKg);
  const hb = heartbeatFrom(beat);
  const unit = massUnit(fmt);
  const readOnly = (
    <dl data-testid="dev3-settings-read" className="m-0 flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-[15px]">
      <div className="flex flex-wrap justify-between gap-2">
        <dt>{t("dev3.settings.tolerance")}</dt>
        <dd className="m-0 font-semibold">{bpToPercentText(s.weighToleranceBp)}%</dd>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <dt>{t("dev3.settings.min")}</dt>
        <dd className="m-0 font-semibold">
          {kgGrouped3(fmt, s.weighToleranceMinG)} {unit}
        </dd>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <dt>{t("dev3.settings.heartbeat")}</dt>
        <dd className="m-0 font-semibold">{s.heartbeatSec}</dd>
      </div>
      <p className="m-0 text-[14px] text-muted-foreground">{t("dev3.settings.readOnly")}</p>
    </dl>
  );
  return (
    <Block id="dev3-settings" title={t("dev3.settings.title")}>
      <Can do="device.manage" fallback={readOnly}>
        <form
          data-testid="dev3-settings-form"
          className="flex max-w-xl flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (bp === null || minG === null || hb === null) return;
            save.mutate({ weighToleranceBp: bp, weighToleranceMinG: minG, heartbeatSec: hb });
          }}
        >
          <Field label={t("dev3.settings.tolerance")} hint={t("dev3.settings.toleranceHint")} error={tried && bp === null ? t("dev3.settings.toleranceBad") : undefined}>
            <NumberInput value={pct} onValueChange={setPct} data-testid="dev3-tolerance" />
          </Field>
          <Field label={t("dev3.settings.min")} hint={t("dev3.settings.minHint")} error={tried && minG === null ? t("dev3.settings.minBad") : undefined}>
            <PlantInput spec={MASS_KG} value={minKg} onValueChange={setMinKg} data-testid="dev3-min-weight" />
          </Field>
          <Field label={t("dev3.settings.heartbeat")} hint={t("dev3.settings.heartbeatHint")} error={tried && hb === null ? t("dev3.settings.heartbeatBad") : undefined}>
            <NumberInput decimal={false} value={beat} onValueChange={setBeat} data-testid="dev3-heartbeat" />
          </Field>
          <Button type="submit" loading={save.isPending} className="self-start" data-testid="dev3-settings-save">
            {t("dev3.settings.save")}
          </Button>
          <DevErrorNote error={save.error} />
        </form>
      </Can>
    </Block>
  );
}
