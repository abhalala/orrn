import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useState } from "react";
import { toast } from "sonner";

import { PlatformLinks, useChrome } from "./chrome";
import {
  bandLabel,
  BHAVESH,
  BHAVESH_ORDER,
  bakiGrams,
  BOOKING_LENGTH_FT,
  BOOKING_NUMBER,
  BOOKING_PCS,
  CERTIFICATE,
  collapsedWeightG,
  DIES,
  FIXTURE_PDF_TOAST,
  FLOOR_BUNDLES,
  formatKg,
  formatKgAuto,
  formatKgPer12,
  inBand,
  OFFICE_WILL_CONFIRM,
  overBandG,
  PORTAL_DISPATCH,
  sectionVisible,
  visibleCopies,
} from "./fixtures";
import { updatePlatformPreviewState, usePlatformPreviewState } from "./state";

const kgFormat = (kg: number) =>
  kg.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PortalScreen() {
  const chrome = useChrome();
  const { dieBands, priceOnSalesOrder, hiddenDieProbe } = usePlatformPreviewState();
  const [booked, setBooked] = useState(false);
  const dies = DIES.filter((die) => sectionVisible(die, BHAVESH.id));
  const orderBaki = bakiGrams(BHAVESH_ORDER.orderedG, BHAVESH_ORDER.dispatchedG);
  const dispatchBundle = FLOOR_BUNDLES.find((bundle) => bundle.packingList === PORTAL_DISPATCH.number);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PlatformLinks current="portal" />
      <p className="m-0 text-[15px] text-muted-foreground">
        Signed in as {BHAVESH.name}, {BHAVESH.city}. Plant navigation is not shown.
      </p>

      <section className="flex min-w-0 flex-col gap-3" aria-label="Dies">
        <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">Dies</h2>
        {hiddenDieProbe ? (
          <EmptyState
            title="Not found"
            body="No die on this party's list matches that request."
            action={
              <Button type="button" onClick={() => updatePlatformPreviewState({ hiddenDieProbe: false })}>
                Back to granted dies
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <p className="m-0 text-[13px] text-muted-foreground">{dies.length} section on this login.</p>
            {dies.map((die) => {
              const copies = visibleCopies(die, BHAVESH.id);
              const single = collapsedWeightG(die.weightMinG, die.weightMaxG);
              return (
                <Card key={die.id}>
                  <CardHeader>
                    <CardTitle>
                      {die.series} {die.section}
                    </CardTitle>
                    <CardDescription>
                      {die.profileKind}
                      {dieBands ? ` · ${bandLabel(die.weightMinG, die.weightMaxG)} kg/12 ft` : ` · ${formatKgPer12(single)} kg/12 ft`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                      {copies.map((copy) => {
                        const over = overBandG(copy.latestG, die.weightMaxG);
                        const inside = inBand(copy.latestG, die.weightMinG, die.weightMaxG);
                        return (
                          <li key={copy.code} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <span className="font-mono tabular-nums">{copy.code}</span>
                            <span className="font-mono tabular-nums">{formatKgPer12(copy.latestG)} kg/12 ft</span>
                            {dieBands && over > 0 ? (
                              <Chip tone="red">Over band · {formatKgPer12(over)} kg/12 ft above {formatKgPer12(die.weightMaxG)}</Chip>
                            ) : null}
                            {dieBands && inside ? <Chip tone="green">In band</Chip> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-3" aria-label="Sales order">
        <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">Sales order</h2>
        <Card>
          <CardHeader>
            <CardTitle className="font-mono">{BHAVESH_ORDER.number}</CardTitle>
            <CardDescription>
              {BHAVESH_ORDER.series} {BHAVESH_ORDER.section} · {BHAVESH_ORDER.lengthFt} ft
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Chip tone="neutral">Confirmed</Chip>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <StatusBlock tone="neutral" title="Ordered" value={BHAVESH_ORDER.orderedG / 1000} unit="kg" format={kgFormat} countUp={false} />
              <StatusBlock tone="blue" title="Dispatched" value={BHAVESH_ORDER.dispatchedG / 1000} unit="kg" format={kgFormat} countUp={false} />
              <StatusBlock
                tone="amber"
                title="baki"
                value={orderBaki / 1000}
                unit="kg"
                format={kgFormat}
                countUp={false}
                meta={`${formatKgAuto(BHAVESH_ORDER.orderedG)} − ${formatKgAuto(BHAVESH_ORDER.dispatchedG)}`}
              />
            </div>
          </CardContent>
        </Card>
        {booked ? (
          <Card>
            <CardHeader>
              <CardTitle className="font-mono">{BOOKING_NUMBER}</CardTitle>
              <CardDescription>Catalogue die Domal 12170 · {BOOKING_LENGTH_FT} ft · {BOOKING_PCS} pcs · no die copy</CardDescription>
            </CardHeader>
            <CardContent>
              <Chip tone="blue">Booking</Chip>
              <p className="m-0 text-[15px] font-semibold" role="status">
                {OFFICE_WILL_CONFIRM}
              </p>
              <p className="m-0 text-[13px] text-muted-foreground">baki {BOOKING_PCS} pcs. Dispatched 0.</p>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="flex min-w-0 flex-col gap-3" aria-label={chrome.dispatch}>
        <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">{chrome.dispatch}</h2>
        <Card>
          <CardHeader>
            <CardTitle className="font-mono">{PORTAL_DISPATCH.number}</CardTitle>
            <CardDescription>Vehicle {PORTAL_DISPATCH.vehicle}</CardDescription>
          </CardHeader>
          <CardContent>
            <Chip tone="green">Completed</Chip>
            {dispatchBundle ? (
              <p className="m-0 text-[15px]">
                Bundle <span className="font-mono">{dispatchBundle.serial}</span> · {formatKg(dispatchBundle.grams)} kg · {dispatchBundle.pcs} pcs · {dispatchBundle.lengthFt} ft · cast{" "}
                <span className="font-mono">{dispatchBundle.cast}</span>
              </p>
            ) : null}
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">
              This packing list is one bundle. A sales order can leave the plant as several packing lists like this one.
            </p>
            <p className="m-0 text-[13px] text-muted-foreground">
              Test certificate <span className="font-mono">{CERTIFICATE.number}</span> rev {CERTIFICATE.revision} · {CERTIFICATE.profileKind} · {CERTIFICATE.standard}. Snapshot, not the live settings.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => toast(FIXTURE_PDF_TOAST)}>
                Download PL
              </Button>
              <Button type="button" variant="secondary" onClick={() => toast(FIXTURE_PDF_TOAST)}>
                Download certificate
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="flex min-w-0 flex-col gap-3" aria-label="Place order">
        <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">Place order</h2>
        <Card>
          <CardHeader>
            <CardTitle>New booking</CardTitle>
            <CardDescription>The line names the catalogue die. No die copy. No rate.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Die</dt>
                <dd className="m-0 mt-0.5 font-mono">Domal 12170</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Length</dt>
                <dd className="m-0 mt-0.5 tabular-nums">{BOOKING_LENGTH_FT} ft</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Pieces</dt>
                <dd className="m-0 mt-0.5 tabular-nums">{BOOKING_PCS}</dd>
              </div>
            </dl>
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">
              {priceOnSalesOrder
                ? "Price is on for the office. This portal still has no rate field."
                : "No rate field. The office sets the rate, if the plant shows price at all."}
            </p>
            <Button type="button" disabled={booked} onClick={() => setBooked(true)}>
              {booked ? OFFICE_WILL_CONFIRM : "Place order"}
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
