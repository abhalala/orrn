import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ReportToggle } from "@/features/reports/report-chrome";
import { kgFromG } from "@/features/press/model";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { CAST_TONE, type CastStatus } from "./model";
import { LoadFailed } from "./ui";

/**
 * `/foundry/stock` (FP-FD-15): billets in the store by alloy, then cast. The kg is the ledger
 * (`stock.billets`); a cast with nothing left drops to the finished list when asked for, never off
 * the page by mistake.
 */
export function FoundryStockScreen() {
  const { t } = useT();
  const [finished, setFinished] = useState(false);
  const query = useQuery({ ...trpc.foundry.stock.billets.queryOptions({ includeZero: finished }), meta: INLINE_ERROR_META });
  const header = <PageHeader title={t("foundry.stock.title")} subtitle={t("foundry.stock.subtitle")} back={{ to: "/casts", label: t("foundry.casts.title") }} />;
  if (showsQueryError(query)) return <>{header}<LoadFailed title={t("foundry.stock.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const d = query.data;
  if (!d) return <>{header}<Skeleton className="h-40 rounded-card" /></>;
  const live = d.casts.filter((c) => c.onHandG !== 0);
  const done = d.casts.filter((c) => c.onHandG === 0);
  return (
    <>
      {header}
      <ReportToggle id="stock-finished" checked={finished} onChange={setFinished} label={t("foundry.stock.showFinished")} />
      {live.length === 0 && done.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("foundry.stock.empty")} />
        </div>
      ) : (
        <>
          <p className="m-0 text-[15px] font-semibold tabular-nums" data-testid="stock-total">
            {t("foundry.stock.total", { kg: kgFromG(d.totalG) })}
          </p>
          {d.byAlloy.map((a) => {
            const casts = live.filter((c) => c.alloy === a.alloy);
            if (casts.length === 0) return null;
            return (
              <section key={a.alloy} aria-labelledby={`alloy-${a.alloy}`} className="flex min-w-0 flex-col gap-3" data-alloy={a.alloy}>
                <h2 id={`alloy-${a.alloy}`} className="m-0 flex flex-wrap items-baseline gap-3 text-[17px] font-semibold">
                  <span className="font-mono">{a.alloy}</span>
                  <span className="text-[14px] font-normal tabular-nums text-muted-foreground">{t("foundry.stock.alloyLine", { kg: kgFromG(casts.reduce((s, c) => s + c.onHandG, 0)), casts: casts.length })}</span>
                </h2>
                <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                  {casts.map((c) => (
                    <CastCard key={c.castId} c={c} />
                  ))}
                </ul>
              </section>
            );
          })}
          {finished && done.length > 0 ? (
            <section aria-labelledby="stock-done" className="flex min-w-0 flex-col gap-3" data-testid="stock-finished">
              <h2 id="stock-done" className="m-0 text-[17px] font-semibold">{t("foundry.stock.finished")}</h2>
              <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {done.map((c) => (
                  <CastCard key={c.castId} c={c} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      <Button asChild variant="secondary" className="self-start">
        <UiLink to="/casts">{t("foundry.casts.title")}</UiLink>
      </Button>
    </>
  );
}

function CastCard({ c }: { c: { castId: string; number: string | null; year: number | null; alloy: string; status: string | null; onHandG: number } }) {
  const { t } = useT();
  return (
    <li className="min-w-0" data-cast={c.number ?? ""}>
      <UiLink to={`/casts/${c.castId}`} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-4 no-underline hover:border-foreground">
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-[20px] font-bold">{c.number ?? "?"}</span>
          {c.status ? <Chip tone={CAST_TONE[c.status as CastStatus] ?? "neutral"}>{t(`foundry.casts.status.${c.status as CastStatus}`)}</Chip> : null}
        </span>
        <span className="text-[13px] text-muted-foreground">{c.year ?? ""}</span>
        <span className="font-mono text-[18px] font-semibold tabular-nums">{kgFromG(c.onHandG)} {t("units.kg")}</span>
        <span className="text-[13px] text-muted-foreground">{t("foundry.stock.onHand")}</span>
      </UiLink>
    </li>
  );
}
