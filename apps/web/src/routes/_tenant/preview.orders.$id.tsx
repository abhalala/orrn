import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";
import { BakiStrip } from "@/features/preview/orders/components/baki-strip";
import {
  basisCaption,
  customerById,
  customerName,
  dieByCode,
  dieTitle,
  finishLabel,
  formatKgShort,
  formatOrderKg,
  formatPcs,
  lengthLabel,
  orderStatusLabel,
  orderStatusTone,
  stripFor,
} from "@/features/preview/orders/fixtures";
import {
  applyReallocateAsManager,
  bhavesh12ftLine,
  confirmOrder,
  dismissNotice,
  requestReallocate,
  resetOrdersDemo,
  so12Stock,
  useOrdersDemo,
} from "@/features/preview/orders/store";

const mod = previewModule("orders")!;

export const Route = createFileRoute("/_tenant/preview/orders/$id")({
  component: OrderDetailPreview,
});

function OrderDetailPreview() {
  const { id } = Route.useParams();
  const demo = useOrdersDemo();
  const order = demo.orders.find((item) => item.number === id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [destination, setDestination] = useState<"plant" | "bhavesh">("plant");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  if (!order || !order.openDetail) {
    return (
      <PreviewFrame title={id} summary="Sales order" featureIds={["FP-OP-01"]} specPath={mod.specPath}>
        <EmptyState
          title={order ? "Preview stops at SO-12 and SO-14." : "This sales order is not in the sample."}
          body={order ? "Open SO-12 or SO-14 from the list." : "The sample was reset, or this number was not booked."}
          action={
            <Button asChild>
              <Link to="/preview/orders">Orders</Link>
            </Button>
          }
        />
      </PreviewFrame>
    );
  }

  const customer = customerById(order.customerId);
  const strip = stripFor(order, demo.yard);
  const stock = so12Stock(demo);
  const bhaveshLine = bhavesh12ftLine(demo);
  const bhaveshLabel = bhaveshLine
    ? `Bhavesh ${bhaveshLine.orderNumber}'s 12 ft line`
    : "Bhavesh Traders — new line, 12 ft";
  const pending = demo.reallocate.status === "pending";
  const canReallocate = order.number === "SO-12" && stock.g > 0;
  const booking = order.status === "booking";

  function submitMove() {
    const message = requestReallocate(destination, reason);
    setFormError(message);
    if (!message && destination === "plant") setSheetOpen(false);
    if (!message && destination === "bhavesh") setSheetOpen(false);
  }

  return (
    <PreviewFrame
      title={order.number}
      summary={`${customer?.name ?? order.customerId}${customer ? `, ${customer.city}` : ""} · ${order.poNumber || "No PO yet"}`}
      featureIds={["FP-OP-01", "FP-OP-04", "FP-OP-05", "FP-OP-06", "FP-OP-07", "FP-OP-08", "FP-OP-09", "FP-OP-14"]}
      specPath={mod.specPath}
      actions={
        <>
          {booking ? (
            <Button
              onClick={() => setConfirmError(confirmOrder(order.number))}
              disabled={!order.poNumber.trim()}
            >
              Confirm
            </Button>
          ) : null}
          {canReallocate ? <Button onClick={() => setSheetOpen(true)}>Reallocate</Button> : null}
          <Button variant="ghost" onClick={() => resetOrdersDemo()}>
            Reset this preview
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        {order.savedNotice ? (
          <p role="status" className="m-0 flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface-sunken px-3 py-2 text-[14px] font-medium leading-5">
            <span>{order.savedNotice}</span>
            <Button variant="ghost" onClick={() => dismissNotice(order.number)}>
              Dismiss
            </Button>
          </p>
        ) : null}
        {confirmError ? (
          <p role="status" className="m-0 text-[14px] font-medium leading-5 text-destructive">
            {confirmError}
          </p>
        ) : null}
        {booking && !order.poNumber.trim() ? (
          <p className="m-0 text-[14px] leading-5 text-muted-foreground">Confirm when the PO number is filled.</p>
        ) : null}
        {demo.plantNote && order.number === "SO-12" ? (
          <p role="status" className="m-0 text-[14px] font-medium leading-5">
            {demo.plantNote}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={orderStatusTone(order.status)}>{orderStatusLabel(order.status)}</Chip>
          {order.number === "SO-12" && strip.bakiG > 0 ? (
            <Chip tone="amber">{formatKgShort(strip.bakiG)} still on this PO</Chip>
          ) : null}
          {pending && order.number === "SO-12" ? (
            <Chip tone="amber">Pending · order reallocate · {formatKgShort(stock.g)}</Chip>
          ) : null}
          {demo.holdPending && order.number === "SO-12" ? (
            <Chip tone="amber">Pending · order reallocate · {formatKgShort(demo.holdPending.kgG)}</Chip>
          ) : null}
        </div>

        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Fact label="Customer" value={customerName(order.customerId)} />
            <Fact label="PO" value={order.poNumber || "—"} mono />
            <Fact label="Order date" value={order.orderDateLabel} />
            <Fact label="Finish" value={finishLabel(order.lines[0]?.finish ?? "none")} />
            <Fact label="Kg tolerance" value="0" />
          </div>
        </Card>

        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="m-0 text-[15px] font-semibold">Balance</h2>
          <BakiStrip strip={strip} />
          <p className="m-0 text-[14px] leading-5 text-muted-foreground">
            {order.number === "SO-12" && order.movedOffG === 0
              ? "Balance is ordered minus dispatched. It does not go below zero. 1,300 kg is still on this PO."
              : order.movedOffG > 0
                ? `Balance is ordered minus dispatched minus what left this PO. ${formatOrderKg(order.movedOffG)} kg left, so the balance shown is ${formatOrderKg(strip.bakiG)} kg. It does not go below zero.`
                : "Balance is ordered minus dispatched. It does not go below zero."}
          </p>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">
            {formatKgShort(strip.inStockG)} in stock · 0 held. In stock is the available part of packed.
          </p>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Lines</CardTitle>
          </CardHeader>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {order.lines.map((line) => {
              const die = dieByCode(line.sectionCode);
              const gap = line.kgG - line.impliedG;
              return (
                <li key={line.id} className="min-w-0 rounded-card border border-border bg-surface-sunken px-3 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="m-0 font-mono text-[15px] font-semibold tabular-nums">
                      {die ? dieTitle(die) : line.sectionCode}
                      {line.copyCode ? ` · ${line.copyCode}` : " · no copy pinned"}
                    </p>
                    {line.received ? <Chip tone="blue">Received</Chip> : null}
                  </div>
                  <p className="m-0 mt-1 text-[14px] leading-5">
                    {lengthLabel(line.cutLengthFt)} · {line.alloy} / {line.temper} · {formatPcs(line.pcs)} pcs ·{" "}
                    {formatOrderKg(line.kgG)} kg
                    {gap !== 0 ? ` typed · ${formatOrderKg(line.impliedG)} kg at ${formatPcs(line.pcs)} pcs` : ""}
                  </p>
                  <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">{basisCaption(line)}</p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          {order.timeline.length === 0 ? (
            <p className="m-0 text-[14px] text-muted-foreground">Nothing has moved yet.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {order.timeline.map((row, index) => (
                <li key={row.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < order.timeline.length - 1 ? (
                    <span aria-hidden="true" className="absolute top-3 bottom-0 left-[5px] w-px bg-border" />
                  ) : null}
                  <span aria-hidden="true" className="relative mt-1.5 size-2.5 shrink-0 rounded-full bg-foreground" />
                  <div className="min-w-0">
                    <p className="m-0 text-[15px] font-semibold leading-5">{row.label}</p>
                    <p className="m-0 text-[13px] leading-5 text-muted-foreground">{row.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {pending && order.number === "SO-12" ? (
          <Button
            variant="secondary"
            onClick={() => {
              const message = applyReallocateAsManager();
              setFormError(message);
            }}
          >
            Apply as manager (demo only)
          </Button>
        ) : null}

        <p className="m-0 text-[13px] leading-5 text-muted-foreground">Rates are off for this company.</p>
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Reallocate"
        description={`${formatOrderKg(stock.g)} kg · ${formatPcs(stock.pcs)} pcs in stock on this PO.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSheetOpen(false)}>
              Leave them
            </Button>
            <Button onClick={submitMove}>Move</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Destination">
            <Select
              value={destination}
              onValueChange={(value) => setDestination(value as "plant" | "bhavesh")}
              options={[
                { value: "plant", label: "Plant stock" },
                { value: "bhavesh", label: bhaveshLabel },
              ]}
              aria-label="Destination"
            />
          </Field>
          {destination === "bhavesh" ? (
            <p className="m-0 text-[14px] font-medium leading-5">Waits for a manager</p>
          ) : (
            <p className="m-0 text-[14px] leading-5 text-muted-foreground">Plant stock applies immediately. It is not a customer.</p>
          )}
          <Field label="Reason" error={formError ?? undefined}>
            <TextArea value={reason} onChangeText={setReason} rows={3} placeholder="Why this kg is leaving the PO" />
          </Field>
        </div>
      </Sheet>
    </PreviewFrame>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-xs font-medium text-muted-foreground">{label}</p>
      <p className={mono ? "m-0 font-mono text-[15px] tabular-nums break-words" : "m-0 text-[15px] break-words"}>{value}</p>
    </div>
  );
}
