import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card } from "@orrn/ui/components/card";

import { Can } from "@/shared/components/can";

import { orderKgText, pcsText } from "../format";

/** One row of `plans.openLinesForDies` (the server's figures; nothing is worked out here). */
export type OtherLine = {
  lineId: string;
  lineNo: number;
  orderNumber: string;
  orderPeriod: string;
  poNumber: string | null;
  customerName: string;
  sectionId: string;
  sectionCode: string;
  cutLengthMm: number;
  planableG: number;
  planablePcs: number | null;
  ownerName: string | null;
  ownerBlocked: boolean;
};

/**
 * FP-OP-15 / BACKLOG rank 30: every other open line on the dies of a plan (party, SO number, PO,
 * length, kg and pieces still to plan), each with Add. A line the owner gate keeps off (FP-OP-16:
 * an owned die and another party) shows why instead of an Add that would be refused.
 */
export function OtherLines({
  rows,
  loading,
  failed,
  more,
  onAdd,
  addingId,
  formatLength,
}: {
  rows: readonly OtherLine[];
  loading: boolean;
  failed: boolean;
  more: boolean;
  onAdd(row: OtherLine): void;
  addingId?: string | null;
  formatLength(mm: number): string;
}) {
  const { t } = useT();
  return (
    <section data-other-lines="" aria-label={t("orders.plan.otherLinesTitle")} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface-sunken px-3 py-3">
      <h3 className="m-0 text-[14px] font-semibold">{t("orders.plan.otherLinesTitle")}</h3>
      {loading ? null : failed ? (
        <p role="alert" className="m-0 text-[14px] text-destructive">
          {t("errors.generic")}
        </p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("orders.plan.otherLinesNone")}</p>
      ) : (
        <>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("orders.plan.otherLinesBody")}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r) => (
              <li key={r.lineId} data-other-line={r.orderNumber}>
                <Card size="sm" className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="m-0 text-[14px] font-medium leading-5 break-words">
                        {r.sectionCode} · {r.customerName}
                      </p>
                      <p className="m-0 font-mono text-[13px] leading-5 tabular-nums break-words">
                        {r.orderNumber} · {t("orders.detail.lineShort", { n: r.lineNo })}
                        {r.poNumber ? ` · ${r.poNumber}` : ""} · {formatLength(r.cutLengthMm)}
                      </p>
                      <p className="m-0 font-mono text-[13px] leading-5 tabular-nums text-muted-foreground">
                        {r.planablePcs != null
                          ? t("orders.plan.planableBoth", { kg: orderKgText(r.planableG), pcs: pcsText(r.planablePcs) })
                          : t("orders.plan.planable", { kg: orderKgText(r.planableG) })}
                      </p>
                      {r.ownerBlocked ? (
                        <p data-owner-blocked="" className="m-0 text-[13px] font-medium leading-5 text-tone-amber-ink">
                          {t("orders.ownedBy", { name: r.ownerName ?? "" })}
                        </p>
                      ) : null}
                    </div>
                    <Can do="order.plan">
                      <Button
                        variant="secondary"
                        disabled={r.ownerBlocked || addingId === r.lineId}
                        onClick={() => onAdd(r)}
                        aria-label={t("orders.plan.addLine", { order: r.orderNumber })}
                      >
                        {t("common.add")}
                      </Button>
                    </Can>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          {more ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("orders.plan.moreLines")}</p> : null}
        </>
      )}
    </section>
  );
}
