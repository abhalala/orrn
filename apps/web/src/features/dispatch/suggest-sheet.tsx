import { formatLength as formatLengthMm, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orderKgText, pcsText } from "@/features/orders/format";
import { addOutcome, renderScanMessage, scanErrorKey, type AddBundlesReport } from "@/features/scan/scan-outcome";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { useCan } from "./hooks";
import { addAllSerials, needsAllowUnassigned, suggestGroups } from "./order-view";

/**
 * "Suggest bundles" for a dispatch opened from a sales order (FP-PK-17): this order's stock in the
 * yard first, then plant stock of the same die and cut length, from `dispatch.suggestBundles`. A
 * bundle a scan would refuse (held, owned die, another customer's) or one held for another order's
 * line is never listed. "Add all that fit" is one tap; each row can also be added alone.
 */
export function SuggestSheet({
  open,
  onOpenChange,
  dispatchId,
  unit,
  onAdded,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  dispatchId: string;
  unit: LengthUnit;
  onAdded(report: AddBundlesReport): void;
}) {
  const { t } = useT();
  const can = useCan();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | "all" | null>(null);
  const [message, setMessage] = useState("");
  const query = useQuery({ ...trpc.dispatch.suggestBundles.queryOptions({ id: dispatchId }), enabled: open });

  const items = query.data?.items ?? [];
  const groups = suggestGroups(items);
  const fitSerials = addAllSerials(items);
  const fitG = query.data?.fitsG ?? 0;

  async function add(serials: string[], key: string | "all") {
    if (serials.length === 0) return;
    setBusy(key);
    try {
      const report = await trpcClient.dispatch.addBundlesBySerial.mutate({
        id: dispatchId,
        serials,
        ...(can("order.manage") && needsAllowUnassigned(items, serials) ? { allowUnassigned: true } : {}),
      });
      if (report.added.length > 0) setMessage(t("dispatch.suggest.added", { count: report.added.length }));
      else {
        const first = serials[0]!;
        const outcome = addOutcome(report, first);
        setMessage(outcome.kind === "rejected" ? `${first}: ${renderScanMessage(t, outcome.message)}` : t("dispatch.suggest.nothingAdded"));
      }
      onAdded(report);
      await queryClient.invalidateQueries({ queryKey: trpc.dispatch.suggestBundles.queryKey({ id: dispatchId }) });
    } catch (error) {
      toast.error(t(scanErrorKey(error, "dispatch")));
    } finally {
      setBusy(null);
    }
  }

  const changeOpen = (next: boolean) => {
    onOpenChange(next);
    if (!next) setMessage("");
  };

  const progress = query.data?.progress;
  return (
    <Sheet
      open={open}
      onOpenChange={changeOpen}
      title={t("dispatch.suggest.title")}
      description={t("dispatch.suggest.intro")}
      footer={<Button onClick={() => changeOpen(false)}>{t("common.done")}</Button>}
    >
      <div className="flex min-w-0 flex-col gap-4 pt-1" data-suggest="">
        {progress ? (
          <p className="m-0 text-[14px] leading-5" data-suggest-left="">
            {t("dispatch.suggest.left", { kg: orderKgText(progress.leftG) })}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className="m-0 min-h-5 text-[14px] font-medium">
          {message}
        </p>
        {query.isPending ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-14 w-full rounded-card" />
            <Skeleton className="h-14 w-full rounded-card" />
          </div>
        ) : query.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0 text-[14px] text-destructive">{t("errors.generic")}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground" data-suggest-empty="">
            {t("dispatch.suggest.empty")}
          </p>
        ) : (
          <>
            <Button size="lg" loading={busy === "all"} disabled={busy !== null || fitSerials.length === 0} onClick={() => void add(fitSerials, "all")} data-suggest-add-all="">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("dispatch.suggest.addAll", { count: fitSerials.length, kg: orderKgText(fitG) })}
            </Button>
            {([
              ["order", groups.order, t("dispatch.suggest.order")],
              ["plant", groups.plant, t("dispatch.suggest.plant")],
            ] as const).map(([key, rows, title]) =>
              rows.length === 0 ? null : (
                <section key={key} data-suggest-group={key} className="flex min-w-0 flex-col gap-1">
                  <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
                  <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border p-0">
                    {rows.map((b) => (
                      <li key={b.id} data-suggest-serial={b.serial} className="flex min-h-16 min-w-0 items-center gap-3 px-3.5 py-2">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="font-mono text-[15px] font-semibold [overflow-wrap:anywhere]">{b.serial}</span>
                          <span className="text-[13px] text-muted-foreground break-words">
                            {b.sectionCode} {b.sectionName ?? b.series} · {formatLengthMm(b.lengthMm, unit)} · {t("dispatch.suggest.forLine", { n: b.lineNo })}
                            <span className="font-mono">
                              {" "}
                              {pcsText(b.pcs)} {t("units.pcs")} · {orderKgText(b.weightG)} {t("units.kg")}
                            </span>
                          </span>
                          <span className="flex flex-wrap gap-1.5">
                            {b.held ? (
                              <Chip tone="blue" truncate={false}>
                                {t("dispatch.suggest.held")}
                              </Chip>
                            ) : null}
                            {b.unassigned ? (
                              <Chip tone="neutral" truncate={false}>
                                {t("dispatch.suggest.unassigned")}
                              </Chip>
                            ) : null}
                            {!b.fits ? (
                              <Chip tone="amber" truncate={false}>
                                {t("dispatch.suggest.pastBaki")}
                              </Chip>
                            ) : null}
                          </span>
                        </div>
                        <Button variant="secondary" className="shrink-0 px-4" loading={busy === b.serial} disabled={busy !== null} onClick={() => void add([b.serial], b.serial)}>
                          <Plus aria-hidden="true" strokeWidth={2} />
                          {t("dispatch.build.add")}
                          <span className="sr-only"> {b.serial}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
            {query.data?.truncated ? <p className="m-0 text-[13px] text-muted-foreground">{t("dispatch.suggest.cut")}</p> : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
