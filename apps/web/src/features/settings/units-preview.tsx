import { useT } from "@orrn/i18n";

import type { PreviewLines } from "./units-model";

/**
 * The five preview lines. Each line is its own polite live region and is read whole (atomic), so a screen reader hears
 * "Weight 272,155 lb" when the weight changes, never a bare value without its label.
 */
export function PreviewList({ lines }: { lines: PreviewLines }) {
  const { t } = useT();
  return (
    <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Fact live label={t("settings.units.sampleWeight")} value={lines.weight} mono testId="preview-weight" />
      <Fact live label={t("settings.units.sampleLength")} value={lines.length} mono testId="preview-length" />
      <Fact live label={t("settings.units.sampleSection")} value={lines.section} mono testId="preview-section" />
      <Fact live label={t("settings.units.sampleNumber")} value={lines.number} mono testId="preview-number" />
      <Fact live label={t("settings.units.sampleDate")} value={lines.date} mono testId="preview-date" />
    </dl>
  );
}

export function Fact({ label, value, mono, testId, live }: { label: string; value: string; mono?: boolean; testId?: string; live?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" {...(live ? { "aria-live": "polite" as const, "aria-atomic": true } : {})}>
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[15px] break-words" : "m-0 text-[15px] break-words"} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
