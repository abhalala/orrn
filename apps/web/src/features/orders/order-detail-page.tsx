/**
 * `/orders/$id`: one order. The balance strip, the totals and every figure are the server's
 * (`orders.get`); Confirm / Close / Cancel are the only status moves and their refusals come back
 * as blockers the page words. Move bundles is the reallocate sheet; a request waiting for a
 * manager shows here with a link to it.
 */
import { formatLength as formatLengthMm } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Boxes, FileText, RefreshCw, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { bookDateText } from "@/features/purchase/format";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { BakiStrip } from "./components/baki-strip";
import { LineFilters } from "./components/line-filters";
import { StockOnSheet } from "./components/stock-on-sheet";
import { EditSheet } from "./components/edit-sheet";
import { ReallocateSheet, type ReallocateSource } from "./components/reallocate-sheet";
import { LinesEditor } from "./components/lines-editor";
import { ReasonSheet } from "./components/reason-sheet";
import { TakeStockSheet, type TakeStockTarget } from "./components/take-stock-sheet";
import { Timeline } from "./components/timeline";
import { lateRuleKey } from "./book-view";
import { orderErrorLines } from "./errors";
import { filterLines, filterOptions, NO_LINE_FILTER, shownTotals, showLineFilters, type FilterableStrip, type LineFilterState } from "./line-filter";
import { milliText, orderKgText, pcsText, rateText } from "./format";
import { blockerText, dieTitle, isOrderStatus, STATUS_TONE, statusActions, type OrderStatus, type Strip } from "./view";

export function OrderDetailPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const { unit } = useLengthUnit();
  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [moveLine, setMoveLine] = useState<ReallocateSource | null>(null);
  const [takeLine, setTakeLine] = useState<TakeStockTarget | null>(null);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [events, setEvents] = useState(50);
  const [stockOpen, setStockOpen] = useState(false);
  const [lineFilter, setLineFilter] = useState<LineFilterState>(NO_LINE_FILTER);

  const get = useQuery(trpc.orders.get.queryOptions({ id }));
  const timeline = useQuery({ ...trpc.orders.timeline.queryOptions({ id, limit: events }) });
  const pending = useQuery(trpc.orders.reallocations.list.queryOptions({ orderId: id, status: "pending" }));

  // FP-OP-05: from 20 lines on the lines can be narrowed; the strips are the server's.
  const stripsById = useMemo(() => new Map((get.data?.lineDetails ?? []).map((d) => [d.lineId, d.strip as FilterableStrip])), [get.data]);
  const longOrder = showLineFilters(get.data?.lines.length ?? 0);
  const shownLines = useMemo(
    () => (get.data && longOrder ? filterLines(get.data.lines, stripsById, lineFilter) : (get.data?.lines ?? [])),
    [get.data, longOrder, stripsById, lineFilter],
  );

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.orders.get.queryKey({ id }) }),
      queryClient.invalidateQueries({ queryKey: trpc.orders.timeline.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.orders.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.orders.late.queryKey() }),
    ]);

  const reprice = useMutation({
    mutationFn: (line: { lineId: string; lineNo: number }) => trpcClient.orders.repriceWeight.mutate({ lineId: line.lineId }),
    onSuccess: async (_res, line) => {
      setErrors([]);
      toast.success(t("orders.detail.weightRefreshed", { n: line.lineNo }));
      await refresh();
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  const confirm = useMutation({
    mutationFn: (serverSeq: number) => trpcClient.orders.confirm.mutate({ id, serverSeq }),
    onSuccess: async () => {
      setErrors([]);
      toast.success(t("orders.confirmed"));
      await refresh();
    },
    onError: async (error) => {
      setErrors(orderErrorLines(t, error));
      await refresh();
    },
  });
  const close = useMutation({
    mutationFn: (reason: string) => trpcClient.orders.close.mutate({ id, ...(reason ? { reason } : {}) }),
    onSuccess: async () => {
      setErrors([]);
      setCloseOpen(false);
      toast.success(t("orders.closed"));
      await refresh();
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => trpcClient.orders.cancel.mutate({ id, reason }),
    onSuccess: async () => {
      setErrors([]);
      setCancelOpen(false);
      toast.success(t("orders.cancelled"));
      await refresh();
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  if (get.isError && get.data === undefined) {
    return (
      <>
        <PageHeader title={t("orders.title")} back={{ to: "/orders", label: t("orders.title") }} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("orders.detail.notFound")}
            action={
              <Button variant="secondary" onClick={() => void get.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      </>
    );
  }
  if (!get.data) {
    return (
      <>
        <PageHeader title={t("orders.title")} back={{ to: "/orders", label: t("orders.title") }} />
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    );
  }

  const { order, lines, totals, confirmBlockers, lineDetails } = get.data;
  const status: OrderStatus = isOrderStatus(order.status) ? order.status : "booking";
  const can = statusActions(status);
  const details = new Map(lineDetails.map((d) => [d.lineId, d]));
  // Review m-1: the late chip comes with the order (`lateDays`), never from a capped list.
  const daysLate = get.data.lateDays;
  const isLate = daysLate != null;
  const waiting = pending.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={order.number}
        subtitle={[order.customerName, order.poNumber || t("orders.noPo")].join(" · ")}
        back={{ to: "/orders", label: t("orders.title") }}
        actions={
          <Can do="order.manage">
            {can.confirm ? (
              <Button size="lg" onClick={() => confirm.mutate(order.serverSeq)} disabled={confirm.isPending}>
                {confirm.isPending ? t("common.saving") : t("orders.confirm")}
              </Button>
            ) : null}
            {can.edit ? (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                {t("common.edit")}
              </Button>
            ) : null}
            {can.edit && !editing ? (
              <Button variant="secondary" onClick={() => (setErrors([]), setEditing(true))}>
                {t("orders.detail.editLines")}
              </Button>
            ) : null}
            {can.close ? (
              <Button variant="secondary" onClick={() => (setErrors([]), setCloseOpen(true))}>
                {t("orders.close")}
              </Button>
            ) : null}
            {can.cancel ? (
              <Button variant="ghost" onClick={() => (setErrors([]), setCancelOpen(true))}>
                {t("orders.cancel")}
              </Button>
            ) : null}
          </Can>
        }
      />

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={STATUS_TONE[status]} truncate={false}>
            {t(`orders.status.${status}`)}
          </Chip>
          {isLate ? (
            <Chip tone="red" truncate={false} title={t(lateRuleKey(get.data.lateRule))}>
              {t("orders.late", { days: daysLate })}
            </Chip>
          ) : null}
          {totals.overG > 0 ? (
            <Chip tone="red" truncate={false}>
              {t("orders.over", { kg: orderKgText(totals.overG) })}
            </Chip>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setStockOpen(true)} data-stock-on-open="" aria-haspopup="dialog">
            <FileText aria-hidden="true" strokeWidth={2} />
            {t("orders.stockOn.button")}
          </Button>
          {status === "confirmed" || status === "dispatching" ? (
            <Can do="dispatch.create">
              <Button variant="secondary" asChild>
                <Link to="/dispatch/new" search={{ salesOrderId: order.id }} data-dispatch-from-order="">
                  <Truck aria-hidden="true" strokeWidth={2} />
                  {t("orders.detail.dispatch")}
                </Link>
              </Button>
            </Can>
          ) : null}
        </div>

        {status === "booking" && confirmBlockers.length > 0 ? (
          <section aria-label={t("orders.toConfirm")} data-confirm-checklist="" className="flex flex-col gap-1 rounded-card border border-border bg-surface-sunken px-4 py-3">
            <h2 className="m-0 text-[14px] font-semibold">{t("orders.toConfirm")}</h2>
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
              {confirmBlockers.map((code) => (
                <li key={code} className="text-[14px] leading-5">
                  {blockerText(code, t)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {errors.length > 0 && !closeOpen && !cancelOpen && !editing ? (
          <div role="alert" data-order-error="" className="flex flex-col gap-1 rounded-card border border-destructive/40 px-4 py-3">
            {errors.map((e) => (
              <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
                {e}
              </p>
            ))}
          </div>
        ) : null}

        {waiting.length > 0 ? (
          <section aria-label={t("orders.pending.title")} className="flex flex-col gap-2">
            {waiting.map((r) => (
              <div
                key={r.approvalId}
                data-pending-request=""
                className="flex min-w-0 flex-col items-start gap-2 rounded-card border border-border bg-tone-amber-tint px-4 py-3 text-tone-amber-ink"
              >
                <Chip tone="amber" truncate={false}>
                  {t("reallocate.waiting")}
                </Chip>
                <p className="m-0 text-[14px] font-medium leading-5">
                  {t("orders.pending.line", {
                    count: r.bundles,
                    kg: orderKgText(r.kgG),
                    order: r.to.orderNumber ?? t("reallocate.toPlant"),
                    customer: r.to.customerName ?? "",
                  })}
                </p>
                <Button variant="secondary" asChild>
                  <Link to="/approvals" search={{ kind: "order_reallocate" }}>
                    {t("reallocate.openRequest")}
                  </Link>
                </Button>
              </div>
            ))}
          </section>
        ) : null}

        <Card>
          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Fact label={t("orders.customer")} value={order.customerName} />
            <Fact label={t("orders.poNumber")} value={order.poNumber || t("orders.noPo")} mono={Boolean(order.poNumber)} />
            <Fact label={t("orders.orderDate")} value={bookDateText(order.orderDate, locale)} />
            {order.expectedDate ? <Fact label={t("orders.expectedDate")} value={bookDateText(order.expectedDate, locale)} /> : null}
            <Fact label={t("orders.source.label")} value={t(`orders.source.${order.source === "portal" ? "portal" : "office"}`)} />
            {order.note ? <Fact label={t("common.note")} value={order.note} /> : null}
            {order.closeReason ? <Fact label={t("orders.closeReason")} value={order.closeReason} /> : null}
            {order.cancelReason ? <Fact label={t("orders.cancelReason")} value={order.cancelReason} /> : null}
          </dl>
        </Card>

        <section className="flex min-w-0 flex-col gap-3" aria-label={t("orders.totals.title")}>
          <h2 className="m-0 text-[15px] font-semibold">{t("orders.totals.title")}</h2>
          <dl data-order-totals="" className="m-0 grid grid-cols-2 gap-2 md:grid-cols-4">
            {(
              [
                ["ordered", totals.orderedG],
                ["produced", totals.producedG],
                ["dispatched", totals.dispatchedG],
                ["baki", totals.bakiG],
              ] as const
            ).map(([key, grams]) => {
              const open = key === "baki" && grams > 0;
              return (
                <div
                  key={key}
                  data-total={key}
                  className={open ? "min-w-0 rounded-card bg-tone-amber-tint px-3 py-3 text-tone-amber-ink" : "min-w-0 rounded-card bg-surface-sunken px-3 py-3"}
                >
                  <dt className={open ? "m-0 text-xs font-medium" : "m-0 text-xs font-medium text-muted-foreground"}>{t(`orders.totals.${key}`)}</dt>
                  <dd className="m-0 mt-1 font-mono text-[15px] font-semibold tabular-nums leading-5 break-words sm:text-base">
                    {orderKgText(grams)} {t("units.kg")}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("orders.bakiNote")}</p>
        </section>

        {editing && can.edit ? (
          <LinesEditor
            order={{ id: order.id, serverSeq: order.serverSeq, customerId: order.customerId }}
            lines={lines}
            details={lineDetails}
            onDone={() => setEditing(false)}
          />
        ) : (
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="m-0 text-[15px] font-semibold">{t("orders.detail.lines")}</h2>
          {longOrder ? (
            <LineFilters
              value={lineFilter}
              onChange={setLineFilter}
              options={filterOptions(lines)}
              unit={unit}
              shown={shownTotals(shownLines)}
              total={lines.length}
            />
          ) : null}
          {shownLines.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("orders.detail.filter.none")}</p> : null}
          {shownLines.map((line) => {
            const d = details.get(line.lineId);
            const strip = d?.strip as Strip | undefined;
            const rate = d && "ratePaise" in d && typeof d.ratePaise === "number" ? d.ratePaise : null;
            return (
              <Card key={line.lineId} data-order-line={line.lineNo}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle>
                    {t("orders.detail.lineShort", { n: line.lineNo })} · {dieTitle({ sectionCode: line.sectionCode, sectionName: line.sectionName, series: line.series })}
                  </CardTitle>
                  <Can do="order.reallocate">
                    {can.move && strip && strip.inStockG > 0 ? (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setMoveLine({
                            lineId: line.lineId,
                            sectionId: line.sectionId,
                            orderNumber: order.number,
                            orderId: order.id,
                            customerId: order.customerId,
                            lineNo: line.lineNo,
                          })
                        }
                      >
                        {t("orders.detail.moveBundles")}
                      </Button>
                    ) : null}
                  </Can>
                </CardHeader>
                <p className="m-0 text-[14px] leading-5">
                  <CopyText sectionId={line.sectionId} dieInstanceId={d?.dieInstanceId ?? null} tierRank={d?.tierRank ?? null} />
                  {" · "}
                  {formatLengthMm(line.cutLengthMm, unit)}
                  {d?.alloy || d?.temper ? ` · ${[d.alloy, d.temper].filter(Boolean).join(" / ")}` : ""}
                  {line.finish ? ` · ${t(`orders.finish.${line.finish === "anodise" || line.finish === "pvd" ? line.finish : "none"}`)}` : ""}
                </p>
                <p className="m-0 font-mono text-[14px] tabular-nums">
                  {line.orderedPcs != null ? `${pcsText(line.orderedPcs)} ${t("units.pcs")} · ` : ""}
                  {orderKgText(line.orderedG)} {t("units.kg")}
                  {rate != null ? ` · ${t("orders.detail.rate", { rate: rateText(rate) })}` : ""}
                </p>
                {d && line.kgPer12ftMilli != null ? (
                  <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                    {d.weightBasis === "band_start" && d.copyMilli == null
                      ? // Review m-10: "no reading, band start used" already names the basis.
                        `${t("orders.detail.basisLineBare", { milli: milliText(line.kgPer12ftMilli) })} ${t("orders.form.noReading")}`
                      : t("orders.detail.basisLine", {
                          milli: milliText(line.kgPer12ftMilli),
                          basis: d.weightBasis ? t(`orders.weightBasis.${d.weightBasis === "band_start" ? "band_start" : "copy_current"}`) : "",
                        })}
                    {d.qtyBasis === "kg" && d.impliedG != null && d.impliedG !== line.orderedG
                      ? ` ${t("orders.detail.implied", { pcs: pcsText(line.orderedPcs ?? 0), implied: orderKgText(d.impliedG) })}`
                      : ""}
                  </p>
                ) : null}
                {strip ? <BakiStrip strip={strip} label={`${order.number} ${t("orders.detail.lineShort", { n: line.lineNo })}`} /> : null}
                {can.move ? (
                  <div className="flex flex-wrap gap-2">
                    <Can do="order.reallocate">
                      <Button
                        variant="secondary"
                        data-take-stock={line.lineNo}
                        onClick={() =>
                          setTakeLine({
                            lineId: line.lineId,
                            lineNo: line.lineNo,
                            orderNumber: order.number,
                            sectionId: line.sectionId,
                            cutLengthMm: line.cutLengthMm,
                            orderId: order.id,
                            customerId: order.customerId,
                          })
                        }
                      >
                        <Boxes aria-hidden="true" strokeWidth={2} />
                        {t("orders.detail.takeStock")}
                      </Button>
                    </Can>
                    {d?.qtyBasis ? (
                      <Can do="order.manage">
                        <Button
                          variant="ghost"
                          disabled={reprice.isPending}
                          onClick={() => reprice.mutate({ lineId: line.lineId, lineNo: line.lineNo })}
                        >
                          <RefreshCw aria-hidden="true" strokeWidth={2} />
                          {t("orders.detail.refreshWeight")}
                        </Button>
                      </Can>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </section>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t("orders.detail.timeline")}</CardTitle>
          </CardHeader>
          {timeline.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <Timeline events={timeline.data?.events ?? []} />
              {timeline.data?.nextOffset != null ? (
                <Button variant="ghost" className="mt-2 self-start" onClick={() => setEvents(200)}>
                  {t("common.showMore")}
                </Button>
              ) : null}
            </>
          )}
        </Card>
      </div>

      <EditSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        order={{ id: order.id, serverSeq: order.serverSeq, poNumber: order.poNumber, expectedDate: order.expectedDate, note: order.note }}
      />
      <StockOnSheet open={stockOpen} onOpenChange={setStockOpen} orderId={order.id} orderNumber={order.number} />
      <ReasonSheet
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={t("orders.close")}
        description={totals.bakiG > 0 ? t("orders.closeBakiHint", { kg: orderKgText(totals.bakiG) }) : undefined}
        label={t("orders.closeReason")}
        submitLabel={t("orders.close")}
        required={totals.bakiG > 0}
        busy={close.isPending}
        errors={closeOpen ? errors : []}
        onSubmit={(reason) => close.mutate(reason)}
      />
      <ReasonSheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("orders.cancel")}
        label={t("orders.cancelReason")}
        submitLabel={t("orders.cancel")}
        required
        busy={cancel.isPending}
        errors={cancelOpen ? errors : []}
        onSubmit={(reason) => cancel.mutate(reason)}
      />
      {takeLine ? (
        <TakeStockSheet
          open
          onOpenChange={(o) => {
            if (!o) setTakeLine(null);
          }}
          target={takeLine}
          formatLength={(mm) => formatLengthMm(mm, unit)}
        />
      ) : null}
      {moveLine ? (
        <ReallocateSheet
          open
          onOpenChange={(o) => {
            if (!o) setMoveLine(null);
          }}
          source={moveLine}
          formatLength={(mm) => formatLengthMm(mm, unit)}
        />
      ) : null}
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[15px] tabular-nums break-words" : "m-0 text-[15px] break-words"}>{value}</dd>
    </div>
  );
}

/** "Copy 14701-2", "Tier 1 or better" or "The die room picks the copy". */
function CopyText({ sectionId, dieInstanceId, tierRank }: { sectionId: string; dieInstanceId: string | null; tierRank: number | null }) {
  const { t } = useT();
  const copies = useQuery({
    ...trpc.dieInstance.list.queryOptions({ sectionId, limit: 200 }),
    enabled: dieInstanceId != null,
    staleTime: 60_000,
  });
  if (dieInstanceId) {
    const code = copies.data?.items.find((c) => c.id === dieInstanceId)?.code;
    return <>{code ? t("orders.line.copyCode", { code }) : t("orders.line.copyPinned")}</>;
  }
  if (tierRank != null) return <>{t("orders.line.tierOrBetter", { rank: tierRank })}</>;
  return <>{t("orders.line.anyCopy")}</>;
}
