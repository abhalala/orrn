import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { PlantInput } from "@/shared/components/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1, rupeeText } from "@/shared/lib/fmt-text";
import { MASS_KG } from "@/shared/lib/plant-input";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { MIX_STATUS_TONE, mixRows, outsideElements, predictedRows, shareText, showsCost, targetG, type MixLine, type MixPredicted, type MixStatus } from "./charge-mix-model";
import { gToKgText } from "./melt-form";
import { ELEMENT_LABEL } from "./model";
import { ErrorLine, FieldSelect, Note } from "./ui";

/**
 * "Suggest a mix" on the charge step (row 47). Display only: the server's cheapest mix inside the alloy's limits from the
 * lots and return streams on hand. It never fills a melt line; the foundry types the charge itself. Closed by default, and
 * nothing is asked of the server until it is opened. The cost shows only when the server sends one.
 */
export function ChargeMixPanel({ alloyId, capacityG }: { alloyId: string; capacityG: number | null }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Can do={["melt.enter", "cast.enter", "masters.publish"]}>
      <section aria-labelledby="mix-title" className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-3" data-testid="charge-mix">
        <h3 id="mix-title" className="m-0 text-[16px] font-semibold">
          <button type="button" className="flex w-full items-center gap-2 bg-transparent p-0 text-left font-semibold" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="mix-toggle">
            {open ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
            {t("fdy2.mix.title")}
          </button>
        </h3>
        {open ? <MixBody alloyId={alloyId} capacityG={capacityG} /> : null}
      </section>
    </Can>
  );
}

function MixBody({ alloyId, capacityG }: { alloyId: string; capacityG: number | null }) {
  const fmt = useFmt();
  const { t } = useT();
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META });
  const [alloy, setAlloy] = useState(alloyId);
  const [target, setTarget] = useState(capacityG ? gToKgText(capacityG) : "");
  const [asked, setAsked] = useState<{ alloyId: string; targetKgG: number } | null>(() => {
    const g = capacityG ? targetG(gToKgText(capacityG)) : null;
    return alloyId && g ? { alloyId, targetKgG: g } : null;
  });
  const result = useQuery({ ...trpc.foundry.chargeMix.suggest.queryOptions(asked ?? { alloyId: "x", targetKgG: 1_000 }), enabled: asked !== null, meta: INLINE_ERROR_META });
  const g = targetG(target);
  const list = (alloys.data?.items ?? []).filter((a) => a.status === "active");
  const words = { max: t("foundry.spectro.max"), min: t("foundry.spectro.min"), to: t("foundry.spectro.to") };
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.mix.hint")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label={t("fdy2.mix.alloy")}>
          <FieldSelect value={alloy} onChange={(e) => setAlloy(e.currentTarget.value)} data-testid="mix-alloy">
            <option value="">{t("fdy2.mix.alloyPick")}</option>
            {list.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
          </FieldSelect>
        </Field>
        <Field label={t("fdy2.mix.target")} error={target !== "" && g === null ? t("fdy2.mix.targetInvalid") : undefined}>
          <PlantInput spec={MASS_KG} value={target} onValueChange={setTarget} data-testid="mix-target" />
        </Field>
        <Button type="button" variant="secondary" disabled={!alloy || g === null} onClick={() => g !== null && setAsked({ alloyId: alloy, targetKgG: g })} data-testid="mix-ask">
          {t("fdy2.mix.ask")}
        </Button>
      </div>
      {asked && showsQueryError(result) ? <ErrorLine error={result.error} /> : null}
      {asked && result.isLoading ? <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.mix.loading")}</p> : null}
      {asked && result.data ? (
        <div className="flex flex-col gap-3" data-testid="mix-result" data-status={result.data.status}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={MIX_STATUS_TONE[result.data.status as MixStatus]} truncate={false}>{t(`fdy2.mix.status.${result.data.status as MixStatus}`)}</Chip>
            <span className="text-[14px] tabular-nums">{t("fdy2.mix.forTarget", { alloy: result.data.alloy, kg: kgGrouped1(fmt, result.data.targetKgG) })}</span>
          </div>
          {result.data.status === "outside_limits" ? <Note tone="amber">{t("fdy2.mix.closest", { elements: outsideElements(result.data.predicted as MixPredicted[]).map((e) => ELEMENT_LABEL[e as keyof typeof ELEMENT_LABEL] ?? e).join(", ") })}</Note> : null}
          {result.data.status === "short_metal" ? <Note tone="red">{t("fdy2.mix.short", { kg: kgGrouped1(fmt, result.data.availableG) })}</Note> : null}
          {result.data.status === "no_sources" ? <Note>{t("fdy2.mix.noSources")}</Note> : null}
          {result.data.lines.length > 0 ? (
            <table className="w-full border-collapse text-left text-[14px]" data-testid="mix-lines">
              <caption className="sr-only">{t("fdy2.mix.lines")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">{t("fdy2.mix.col.source")}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">{t("fdy2.mix.col.kg")}</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{t("fdy2.mix.col.share")}</th>
                </tr>
              </thead>
              <tbody>
                {mixRows(result.data.lines as MixLine[]).map((l) => (
                  <tr key={l.key} className="border-b border-border last:border-0" data-line={l.key}>
                    <td className="min-w-0 py-1.5 pr-3 break-words">
                      {l.label}
                      {l.kind === "stream" ? <span className="ml-2 text-[12px] text-muted-foreground">{t("fdy2.mix.stream")}</span> : null}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{t("fdy2.mix.kgLine", { kg: kgGrouped1(fmt, l.kgG) })}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{shareText(l.shareBp)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {result.data.predicted.length > 0 ? (
            <table className="w-full border-collapse text-left text-[14px]" data-testid="mix-predicted">
              <caption className="sr-only">{t("fdy2.mix.predicted")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-medium">{t("foundry.spectro.element")}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">%</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">{t("foundry.spectro.limit")}</th>
                  <th scope="col" className="py-1.5 font-medium">{t("fdy2.mix.col.reading")}</th>
                </tr>
              </thead>
              <tbody>
                {predictedRows(result.data.predicted as MixPredicted[], words).map((r) => (
                  <tr key={r.element} className="border-b border-border last:border-0" data-element={r.element}>
                    <th scope="row" className="py-1.5 pr-3 font-mono font-semibold">{ELEMENT_LABEL[r.element as keyof typeof ELEMENT_LABEL] ?? r.element}</th>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{r.pct}</td>
                    <td className="py-1.5 pr-3 font-mono text-[13px] tabular-nums text-muted-foreground">{r.limit}</td>
                    <td className="py-1.5"><Chip tone={r.ok ? "green" : "red"}>{t(r.ok ? "foundry.spectro.readingPass" : "foundry.spectro.readingFail")}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {showsCost(result.data.costPaise) ? <p className="m-0 text-[14px] font-semibold tabular-nums" data-testid="mix-cost">{t("fdy2.mix.cost", { amount: rupeeText(fmt, result.data.costPaise) })}</p> : null}
          {result.data.skipped.some((s) => s.reason === "no_chemistry") ? (
            <p className="m-0 text-[13px] text-muted-foreground">
              {t("fdy2.mix.skipped", { count: result.data.skipped.filter((s) => s.reason === "no_chemistry").length })}{" "}
              <UiLink to="/foundry/chemistry">{t("fdy2.mix.setChemistry")}</UiLink>
            </p>
          ) : null}
          {result.data.lines.length > 0 ? <Note tone="neutral" testId="mix-note">{t("fdy2.mix.enterYourself")}</Note> : null}
        </div>
      ) : null}
    </div>
  );
}
