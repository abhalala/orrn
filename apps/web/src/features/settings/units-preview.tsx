import { useT } from "@orrn/i18n";

import type { PreviewLines } from "./units-model";

/** The five preview lines. A polite live region, so a screen reader hears the sample change as the choice changes. */
export function PreviewList({ lines }: { lines: PreviewLines }) {
  const { t } = useT();
  return (
    <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-live="polite">
      <Fact label={t("settings.units.sampleWeight")} value={lines.weight} mono testId="preview-weight" />
      <Fact label={t("settings.units.sampleLength")} value={lines.length} mono testId="preview-length" />
      <Fact label={t("settings.units.sampleSection")} value={lines.section} mono testId="preview-section" />
      <Fact label={t("settings.units.sampleNumber")} value={lines.number} mono testId="preview-number" />
      <Fact label={t("settings.units.sampleDate")} value={lines.date} mono testId="preview-date" />
    </dl>
  );
}

export function Fact({ label, value, mono, testId }: { label: string; value: string; mono?: boolean; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[15px] break-words" : "m-0 text-[15px] break-words"} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
