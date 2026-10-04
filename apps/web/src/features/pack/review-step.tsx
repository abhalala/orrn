import { formatKg, formatKgTotal, formatLength, gToKg, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BigNumber } from "@orrn/ui/components/big-number";
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { forwardRef, useMemo } from "react";

import { Can } from "@/shared/components/can";

import type { DieOption } from "./die-step";
import { draftTotals } from "./pack-math";
import { Measure, PackBar, RangeChip, bundleRange, formatK12 } from "./pack-ui";
import type { PackDraft } from "./use-pack-draft";

type Props = {
  draft: PackDraft;
  unit: LengthUnit;
  die: DieOption | null;
  /** The session's yard code, or null for a company without yards. */
  yardCode: string | null;
  canPrint: boolean;
  saving: boolean;
  saveError: string | null;
  /** The success moment: the totals block pops before the session page opens. */
  popped: boolean;
  onBack(): void;
  onSave(): void;
};

/**
 * Step 3: the totals the packer checks against the floor (bundles, pieces,
 * kg) in the step's one loud block, a calm amber note for out-of-range
 * bundles (it never blocks saving), the session details and every bundle.
 * The main button says what it will do: print labels only when this person
 * can print and label printing is connected.
 */
export const ReviewStep = forwardRef<HTMLDivElement, Props>(function ReviewStep(
  { draft, unit, die, yardCode, canPrint, saving, saveError, popped, onBack, onSave },
  ref,
) {
  const { t } = useT();
  const totals = draftTotals(draft.bundles);
  const rows = useMemo(
    () =>
      draft.bundles.map((b, i) => {
        const lengthMm = b.lengthMm ?? draft.defaults.lengthMm;
        return { n: i + 1, b, lengthMm, ...bundleRange({ ...b, lengthMm }, die) };
      }),
    [draft.bundles, draft.defaults.lengthMm, die],
  );
  const outside = rows.filter((r) => r.verdict === "below" || r.verdict === "above").length;

  return (
    <div ref={ref} className="flex flex-col gap-4">
      <div
        data-slot="pack-totals"
        className={cn(
          "orrn-block orrn-block-neutral orrn-block-sheen grid grid-cols-2 gap-x-4 gap-y-5 p-5 sm:grid-cols-3 sm:p-6",
          popped && "animate-pop",
        )}
      >
        <Total label={t("pack.new.totalBundles")} value={totals.bundles} />
        <Total label={t("pack.new.totalPieces")} value={totals.pieces} />
        <Total
          label={t("pack.new.totalKg")}
          value={gToKg(totals.weightG)}
          format={formatKgTotal}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {outside > 0 ? (
        <p className="m-0 flex items-start gap-2.5 rounded-card bg-tone-amber-tint px-4 py-3 text-[14px] leading-6 font-medium text-tone-amber-ink">
          <AlertTriangle aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0" />
          <span>{t("pack.new.outOfRange", { count: outside })}</span>
        </p>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-x-5 gap-y-3 rounded-card border border-border bg-card p-4 sm:grid-cols-4 sm:p-5">
        <Fact label={t("pack.new.chosenDie")}>
          <span className="font-mono font-semibold">{die?.sectionCode ?? ""}</span>
          {die ? <span className="ml-2 text-[13px] text-muted-foreground">{die.series}</span> : null}
        </Fact>
        <Fact label={t("pack.new.cutLength")}>
          <span className="font-mono font-semibold whitespace-nowrap">
            {formatLength(draft.defaults.lengthMm, unit)}
          </span>
        </Fact>
        <Fact label={t("pack.new.po")}>
          {draft.defaults.po ? (
            <span className="font-mono font-semibold break-all">{draft.defaults.po}</span>
          ) : (
            <span className="text-muted-foreground">{t("pack.new.noPo")}</span>
          )}
        </Fact>
        {yardCode ? (
          <Fact label={t("pack.new.yard")}>
            <span className="font-mono font-semibold">{yardCode}</span>
          </Fact>
        ) : (
          <Fact label={t("pack.new.totalBundles")}>
            <span className="font-semibold">{t("units.bundles", { count: totals.bundles })}</span>
          </Fact>
        )}
      </dl>

      <section aria-labelledby="pack-review-list" className="flex flex-col gap-2">
        <h3 id="pack-review-list" className="m-0 text-[15px] font-semibold">
          {t("pack.new.savedBundles")}
        </h3>
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {/* Phones: compact rows. From 768px: a real table with headers. */}
          <ol className="m-0 list-none divide-y divide-border p-0 md:hidden">
            {rows.map((r) => (
              <li key={r.n} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5">
                <span className="font-mono text-[13px] font-semibold text-muted-foreground tabular-nums">{r.n}</span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-0.5 text-[15px]">
                  <Measure value={formatKg(gToKg(r.b.weightG))} unit={t("units.kg")} className="font-semibold" />
                  <Measure value={String(r.b.pieces)} unit={t("units.pcs")} />
                  {r.b.lengthMm !== undefined ? (
                    <span className="font-mono text-[14px] whitespace-nowrap">{formatLength(r.lengthMm, unit)}</span>
                  ) : null}
                  {r.k !== null ? (
                    <Measure value={formatK12(r.k)} unit={t("units.kgPer12ft")} className="text-[14px]" />
                  ) : null}
                </span>
                <RangeChip verdict={r.verdict} />
              </li>
            ))}
          </ol>
          <table className="hidden w-full border-collapse text-[14px] md:table">
            <caption className="sr-only">{t("pack.new.savedBundles")}</caption>
            <thead>
              <tr className="border-b border-border text-[13px] text-muted-foreground">
                <th scope="col" className="h-11 pr-3 pl-5 text-left font-semibold">
                  #
                </th>
                <th scope="col" className="px-3 text-right font-semibold whitespace-nowrap">
                  {t("pack.new.weight")}
                </th>
                <th scope="col" className="px-3 text-right font-semibold">
                  {t("pack.new.pieces")}
                </th>
                <th scope="col" className="px-3 text-left font-semibold">
                  {t("pack.new.cutLength")}
                </th>
                <th scope="col" className="px-3 text-left font-semibold">
                  {t("pack.new.po")}
                </th>
                <th scope="col" className="px-3 text-right font-semibold">
                  {t("units.kgPer12ft")}
                </th>
                <th scope="col" className="pr-5 pl-3 text-left font-semibold">
                  <span className="sr-only">{t("stock.columns.status")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.n} className="border-b border-border last:border-0">
                  <td className="h-12 pr-3 pl-5 font-mono text-muted-foreground tabular-nums">{r.n}</td>
                  <td className="px-3 text-right font-mono font-semibold tabular-nums">
                    {formatKg(gToKg(r.b.weightG))}
                  </td>
                  <td className="px-3 text-right font-mono tabular-nums">{r.b.pieces}</td>
                  <td className="px-3 font-mono whitespace-nowrap">{formatLength(r.lengthMm, unit)}</td>
                  <td className="px-3 font-mono break-all">{r.b.po ?? draft.defaults.po ?? ""}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{r.k !== null ? formatK12(r.k) : ""}</td>
                  <td className="pr-5 pl-3">
                    <RangeChip verdict={r.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {saveError ? (
        <p
          role="alert"
          className="m-0 flex items-start gap-2 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink"
        >
          <AlertCircle aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0" />
          <span>{saveError}</span>
        </p>
      ) : null}

      <PackBar>
        <Button variant="secondary" size="lg" onClick={onBack} disabled={saving}>
          {t("pack.new.backToBundles")}
        </Button>
        <Can do="bundle.pack">
          <Button size="lg" onClick={onSave} loading={saving} className="sm:min-w-[220px]">
            {canPrint ? t("pack.new.saveAndPrint") : t("pack.new.saveOnly")}
          </Button>
        </Can>
      </PackBar>
    </div>
  );
});

function Total({
  label,
  value,
  format,
  className,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[13px] font-semibold">{label}</span>
      <BigNumber value={value} format={format} className="text-[40px] sm:text-[44px] lg:text-[52px]" />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-[15px] break-words">{children}</dd>
    </div>
  );
}
