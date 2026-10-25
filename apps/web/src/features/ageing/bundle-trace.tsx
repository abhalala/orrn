import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { x10Text } from "./model";

const TONE = { aged: "green", in_ageing: "amber", held: "red", not_aged: "neutral" } as const;

/**
 * The bundle page's ageing line (FP-AG-13): "Aged" with the batch, trolley, oven, recipe, times and
 * hardness it passed, linking to the batch for people who may read ageing. A bundle that never met
 * a trolley says "Not aged" and nothing else. Read from `ageing.bundleTrace` (any member).
 */
export function BundleAgeing({ bundleId }: { bundleId: string }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const { data: me } = useMe();
  const trace = useQuery({ ...trpc.ageing.bundleTrace.queryOptions({ bundleId }), staleTime: 30_000, meta: INLINE_ERROR_META });
  const d = trace.data;
  if (!d) return null;
  const mayOpen = can(me, "ageing.view");
  const facts: [string, string][] = [];
  if (d.trolleyCode) facts.push([t("ageing.field.trolley"), d.trolleyCode]);
  if (d.ovenCode) facts.push([t("ageing.field.oven"), d.ovenCode]);
  if (d.recipeLabel) facts.push([t("ageing.field.recipe"), d.recipeLabel]);
  if (d.inAt) facts.push([t("ageing.field.inAt"), when(d.inAt)]);
  if (d.outAt) facts.push([t("ageing.field.outAt"), when(d.outAt)]);
  if (d.releasedAt) facts.push([t("ageing.trace.released"), when(d.releasedAt)]);
  if (d.hardnessReadingX10 !== null) facts.push([t("ageing.field.hardness"), `${x10Text(d.hardnessReadingX10)} ${d.hardnessMethod ? t(`ageing.method.${d.hardnessMethod}`) : ""}`]);
  if (d.castCode) facts.push([t("ageing.field.cast"), d.castCode]);
  return (
    <section aria-labelledby="bundle-ageing" data-testid="bundle-ageing" data-state={d.state} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bundle-ageing" className="m-0 text-[17px] font-semibold">
          {t("ageing.trace.title")}
        </h2>
        <Chip tone={TONE[d.state]} truncate={false} data-testid="aged-badge">
          {t(`ageing.bundleState.${d.state}`)}
        </Chip>
      </div>
      {d.batchNumber ? (
        <p className="m-0 text-[15px]">
          {mayOpen && d.batchId ? (
            <UiLink to={`/ageing/batch/${d.batchId}`} className="font-mono font-semibold" data-testid="aged-batch-link">
              {d.batchNumber}
            </UiLink>
          ) : (
            <span className="font-mono font-semibold">{d.batchNumber}</span>
          )}{" "}
          {d.pressRunNumber && d.pressRunId ? <span className="text-muted-foreground">· {d.pressRunNumber}</span> : null}
        </p>
      ) : (
        <p className="m-0 text-[14px] text-muted-foreground">{t("ageing.trace.none")}</p>
      )}
      {facts.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
              <dd className="m-0 text-[15px] font-semibold break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
