import { useT } from "@orrn/i18n";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { kgFromG } from "@/features/press/model";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useDuration } from "./hooks";
import { x10Text } from "./model";
import { SoakChip } from "./ui";

/**
 * What an approver needs before they let a short or failed batch go (`ageing_override`): the
 * batch, its recipe, the soak verdict with the minutes, and each line's hardness. Read from
 * `ageing.batches.get`, which people with `ageing.view` (the approvers) may call.
 */
export function AgeingOverrideFigures({ batchId }: { batchId: string }) {
  const { t } = useT();
  const duration = useDuration();
  const q = useQuery({ ...trpc.ageing.batches.get.queryOptions({ id: batchId }), meta: INLINE_ERROR_META });
  if (showsQueryError(q)) return <p className="m-0 text-[14px] text-muted-foreground">{t("approvals.figuresHidden")}</p>;
  if (!q.data) return <Skeleton className="h-24 rounded-card" />;
  const b = q.data;
  const rows: [string, React.ReactNode][] = [
    [t("ageing.field.number"), <span key="n" className="font-mono">{b.number}</span>],
    [t("ageing.field.recipe"), b.recipeLabel ?? "-"],
    [t("ageing.field.loaded"), t("ageing.pcsKg", { pcs: b.totals.loadedPcs, kg: kgFromG(b.totals.loadedKgG) })],
  ];
  if (b.snapshot) rows.push([t("ageing.field.target"), `${x10Text(b.snapshot.targetTempX10)} ± ${x10Text(b.snapshot.toleranceX10)} °C · ${duration(b.snapshot.soakMin)}`]);
  if (b.soak) {
    rows.push([t("ageing.verdict.title"), <SoakChip key="s" verdict={b.soak.verdict} />]);
    rows.push([t("ageing.verdict.inBand"), duration(b.soak.inBandMin)]);
    rows.push([t("ageing.verdict.above"), duration(b.soak.aboveBandMin)]);
    rows.push([t("ageing.verdict.unknown"), duration(b.soak.unknownMin)]);
  }
  return (
    <section className="flex flex-col gap-2" data-testid="ageing-override-figures">
      <h3 className="m-0 text-[14px] font-semibold">{t("approvals.ageing.title")}</h3>
      <dl className="m-0 flex flex-col divide-y divide-border rounded-card border border-border px-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-2 text-[15px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 text-right font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t("ageing.batch.lines")}>
        {b.rows.filter((r) => r.status !== "void").map((r) => (
          <li key={r.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-[14px]" data-testid="override-line">
            <span className="min-w-0 flex-1 break-words">{r.sectionLabel} · {r.lengthMm} mm · {r.pcs} {t("units.pcs")}</span>
            <span className="font-mono">
              {r.hardnessReadingX10 === null ? t("ageing.hardness.untested") : `${x10Text(r.hardnessReadingX10)} ${r.hardnessMethod ? t(`ageing.method.${r.hardnessMethod}`) : ""} · ${r.hardnessPass ? t("ageing.readings.pass") : t("ageing.readings.fail")}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
