import { formatLength as formatLengthMm, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Field } from "@orrn/ui/components/field";

import { orderKgText, pcsText } from "../format";
import { LINE_STAGES, lineFilterActive, NO_LINE_FILTER, type LineFilterState, type LineStage } from "../line-filter";
import { FieldSelect } from "./controls";

/** The line filters of a long order (FP-OP-05): die, cut length, stage, has baki, and the totals of what is shown. */
export function LineFilters({
  value,
  onChange,
  options,
  unit,
  shown,
  total,
}: {
  value: LineFilterState;
  onChange(next: LineFilterState): void;
  options: { dies: { id: string; label: string }[]; lengths: number[] };
  unit: LengthUnit;
  /** The server's lines and totals for the filter (`orders.get` `shown`). */
  shown: { lines: number; orderedPcs: number; orderedG: number; pcsMissing: number };
  total: number;
}) {
  const { t } = useT();
  return (
    <div data-line-filters="" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-3" role="search" aria-label={t("orders.detail.filter.label")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("orders.detail.filter.die")}>
          <FieldSelect value={value.die} onChange={(e) => onChange({ ...value, die: e.target.value })}>
            <option value="">{t("orders.detail.filter.anyDie")}</option>
            {options.dies.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("orders.detail.filter.length")}>
          <FieldSelect value={value.length} onChange={(e) => onChange({ ...value, length: e.target.value })}>
            <option value="">{t("orders.detail.filter.anyLength")}</option>
            {options.lengths.map((mm) => (
              <option key={mm} value={String(mm)}>
                {formatLengthMm(mm, unit)}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("orders.detail.filter.stage")}>
          <FieldSelect value={value.stage} onChange={(e) => onChange({ ...value, stage: e.target.value as LineStage | "" })}>
            <option value="">{t("orders.book.filter.anyStage")}</option>
            {LINE_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`orders.book.stage.${s}`)}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <div className="flex items-end pb-2">
          <label className="inline-flex min-h-11 items-center gap-2 text-[14px] font-medium">
            <Checkbox checked={value.hasBaki} onCheckedChange={(on) => onChange({ ...value, hasBaki: on === true })} />
            {t("orders.detail.filter.hasBaki")}
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-line-filter-totals="" className="m-0 font-mono text-[13px] tabular-nums" aria-live="polite">
          {t("orders.detail.filter.shown", { shown: shown.lines, total })} · {pcsText(shown.orderedPcs)} {t("units.pcs")} · {orderKgText(shown.orderedG)} {t("units.kg")}
          {shown.pcsMissing > 0 ? ` · ${t("orders.detail.filter.pcsMissing", { n: shown.pcsMissing })}` : ""}
        </p>
        {lineFilterActive(value) ? (
          <Button variant="ghost" onClick={() => onChange(NO_LINE_FILTER)}>
            {t("orders.book.filter.clear")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
