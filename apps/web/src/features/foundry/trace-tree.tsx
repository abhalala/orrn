import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { kgFromG } from "@/features/press/model";
import { bundleDetailPath } from "@/shared/lib/paths";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { MELT_TONE, verdictTone, type MeltStatus } from "./model";
import { LoadFailed } from "./ui";

/** One branch: a heading with a count, its rows below. */
function Branch({ title, count, children, testId }: { title: string; count?: number; children: ReactNode; testId: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
      <p className="m-0 text-[15px] font-semibold">
        {title}
        {count !== undefined ? <span className="ml-2 font-normal text-muted-foreground">{count}</span> : null}
      </p>
      {children}
    </li>
  );
}

const ROWS = "m-0 flex list-none flex-col gap-1 border-l border-border p-0 pl-3";
const ROW = "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[14px]";

/**
 * The cast's chain as a tree (FP-FD-17): lots in, melts with their spectro, billets, press runs,
 * bundles and the customers they went to. The figures are `casts.trace`; a bundle number from the
 * trace box (`highlight`) is marked. Press runs and bundles are links.
 */
export function TraceTree({ castId, highlight }: { castId: string; highlight?: string }) {
  const { t } = useT();
  const query = useQuery({ ...trpc.foundry.casts.trace.queryOptions({ castId }), meta: INLINE_ERROR_META });
  if (showsQueryError(query)) return <LoadFailed title={t("foundry.cast.trace.loadFailed")} onRetry={() => void query.refetch()} />;
  const d = query.data;
  if (!d) return <Skeleton className="h-40 rounded-card" />;
  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0" data-testid="trace-tree">
      <Branch title={t("foundry.cast.trace.lots")} count={d.lotsIn.length} testId="trace-lots">
        {d.lotsIn.length === 0 ? (
          <p className="m-0 pl-3 text-[14px] text-muted-foreground">{t("foundry.cast.trace.noLots")}</p>
        ) : (
          <ul className={ROWS}>
            {d.lotsIn.map((l) => (
              <li key={l.lotId} className={ROW}>
                <span className="font-mono font-semibold">{l.lotNumber}</span>
                <span className="text-muted-foreground">{[l.itemName, l.gradeCode].filter(Boolean).join(" · ")}</span>
                <span className="tabular-nums">{kgFromG(l.kgG)} {t("units.kg")}</span>
              </li>
            ))}
          </ul>
        )}
      </Branch>
      <Branch title={t("foundry.cast.trace.melts")} count={d.melts.filter((m) => m.status === "locked" || m.status === "draft").length} testId="trace-melts">
        <ul className={ROWS}>
          {d.melts.map((m) => (
            <li key={m.id} className={ROW}>
              <span className="font-semibold">{t("foundry.melt.number", { n: m.seq })}</span>
              <Chip tone={MELT_TONE[m.status as MeltStatus] ?? "neutral"}>{t(`foundry.melt.status.${m.status}`)}</Chip>
              {m.furnaceCode ? <span className="font-mono">{m.furnaceCode}</span> : null}
              <span className="tabular-nums">{t("foundry.cast.trace.inLogs", { inKg: kgFromG(m.inputG), logs: kgFromG(m.logsG) })}</span>
              {m.status === "locked" ? (
                m.spectroVerdict ? (
                  <Chip tone={verdictTone(m.spectroVerdict)}>{t(`foundry.spectro.verdict.${m.spectroVerdict}`)}</Chip>
                ) : (
                  <Chip tone="neutral">{t("foundry.spectro.none")}</Chip>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </Branch>
      <Branch title={t("foundry.cast.trace.billets")} testId="trace-billets">
        <p className="m-0 border-l border-border pl-3 text-[14px] tabular-nums">
          {t("foundry.cast.trace.billetsLine", { produced: kgFromG(d.billets.producedG), pressed: kgFromG(d.billets.creditedG), onHand: kgFromG(d.billets.onHandG) })}
        </p>
      </Branch>
      <Branch title={t("foundry.cast.trace.runs")} count={d.runs.length} testId="trace-runs">
        {d.runs.length === 0 ? (
          <p className="m-0 pl-3 text-[14px] text-muted-foreground">{t("foundry.cast.trace.noRuns")}</p>
        ) : (
          <ul className={ROWS}>
            {d.runs.map((r) => (
              <li key={r.id} className={ROW}>
                <UiLink to={`/press/runs/${r.id}`} className="font-mono font-semibold underline underline-offset-4">
                  {r.number}
                </UiLink>
                {r.dieCode ? <span className="font-mono text-muted-foreground">{r.dieCode}</span> : null}
                <span className="tabular-nums">{kgFromG(r.billetG)} {t("units.kg")}</span>
                <span className="text-muted-foreground">{r.productionDay}</span>
              </li>
            ))}
          </ul>
        )}
      </Branch>
      <Branch title={t("foundry.cast.trace.bundles")} count={d.bundles.length} testId="trace-bundles">
        {d.bundles.length === 0 ? (
          <p className="m-0 pl-3 text-[14px] text-muted-foreground">{t("foundry.cast.trace.noBundles")}</p>
        ) : (
          <ul className={ROWS}>
            {d.bundles.map((b) => (
              <li key={b.id} className={ROW} data-serial={b.serial} data-highlight={highlight === b.serial ? "true" : undefined}>
                <UiLink to={bundleDetailPath(b)} className={`font-mono font-semibold underline underline-offset-4 ${highlight === b.serial ? "rounded bg-tone-amber-tint px-1" : ""}`}>
                  {b.serial}
                </UiLink>
                <span className="tabular-nums">{kgFromG(b.weightG ?? 0)} {t("units.kg")}</span>
                <span className="text-muted-foreground">{t(`status.bundle.${b.status}`)}</span>
              </li>
            ))}
          </ul>
        )}
        {d.bundlesTruncated ? <p className="m-0 pl-3 text-[13px] text-muted-foreground">{t("foundry.cast.trace.truncated")}</p> : null}
      </Branch>
      <Branch title={t("foundry.cast.trace.customers")} count={d.customers.length} testId="trace-customers">
        {d.customers.length === 0 ? (
          <p className="m-0 pl-3 text-[14px] text-muted-foreground">{t("foundry.cast.trace.noCustomers")}</p>
        ) : (
          <ul className={ROWS}>
            {d.customers.map((c) => (
              <li key={c.customerId} className={ROW}>
                <UiLink to={`/customers/${c.customerId}`} className="font-semibold underline underline-offset-4">
                  {c.name}
                </UiLink>
                <span className="tabular-nums">{t("units.bundlesKg", { bundles: c.bundles, kg: kgFromG(c.weightG) })}</span>
              </li>
            ))}
          </ul>
        )}
      </Branch>
    </ul>
  );
}
