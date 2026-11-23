import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useQuery } from "@tanstack/react-query";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { kgWithUnit, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";
import { useModuleOn } from "@/shared/lib/modules";

export type MakerCostRow = {
  makerId: string | null;
  makerName: string | null;
  copies: number;
  costPaise: number;
  producedG: number;
  costPerKgPaise: number | null;
};

/** The table itself, from rows alone (no queries), so it renders in a test. */
export function CostByMakerTable({ rows }: { rows: readonly MakerCostRow[] }) {
  const { t } = useT();
  const fmt = useFmt();
  return (
    <div className="min-w-0 overflow-x-auto rounded-card border border-border bg-card">
      <table className="w-full border-collapse text-left text-[14px]" data-testid="cost-by-maker">
        <thead>
          <tr className="border-b border-border text-[12px] font-medium text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("adm.floor.makers.maker")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("adm.floor.makers.copies")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("adm.floor.makers.cost")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("adm.floor.makers.made")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("adm.floor.makers.perKg", { massUnit: massUnit(fmt) })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.makerId ?? "none"} className="border-b border-border last:border-b-0">
              <th scope="row" className="px-3 py-2 font-semibold">{r.makerName ?? t("adm.floor.makers.noMaker")}</th>
              <td className="px-3 py-2 text-right tabular-nums">{r.copies}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt.q("order.amount", r.costPaise)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{kgWithUnit(fmt, r.producedG)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{r.costPerKgPaise == null ? "" : fmt.q("order.rate", r.costPerKgPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostByMakerSection() {
  const { t } = useT();
  const fmt = useFmt();
  const query = useQuery({ ...trpc.toolRoom.cost.byMaker.queryOptions(), meta: INLINE_ERROR_META });
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="makers-cost" data-testid="makers-cost">
      <h2 id="makers-cost" className="m-0 text-[17px] leading-6 font-semibold">
        {t("adm.floor.makers.title", { massUnit: massUnit(fmt) })}
      </h2>
      {query.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0 text-[14px] text-destructive">{t("errors.generic")}</p>
          <Button variant="secondary" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : query.isSuccess && query.data.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("adm.floor.makers.empty")}</p>
      ) : query.isSuccess ? (
        <CostByMakerTable rows={query.data} />
      ) : null}
    </section>
  );
}

/** Cost per kg by maker, for people who see money (the server refuses everyone else, so it is not even asked). */
function CostByMakerInner() {
  return (
    <Can do={["masters.publish", "analytics.view"]}>
      <CostByMakerSection />
    </Can>
  );
}

/** PROD-GATE: renders (and asks the server) only with the opt-in `masters_plus` module on. */
export function CostByMaker() {
  return useModuleOn("masters_plus") ? <CostByMakerInner /> : null;
}
