import { ActionTile } from "@orrn/ui/components/action-tile";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { FileText, PackagePlus, Truck } from "lucide-react";
import { useState } from "react";

import { PlatformLinks, useChrome } from "./chrome";
import {
  BHAVESH,
  BHAVESH_ORDER,
  bakiGrams,
  CLOCK_NOW_MIN,
  CLOCK_PRETEND_MIN,
  formatKg,
  formatKgAuto,
  PLANT,
  productionDayCaption,
  SAVED_SHIFTS,
  shift1,
  shiftAt,
  shiftChromeName,
  todayKpis,
} from "./fixtures";

const kgFormat = (kg: number) =>
  kg.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TodayScreen() {
  const chrome = useChrome();
  const [pretend, setPretend] = useState(false);
  const minute = pretend ? CLOCK_PRETEND_MIN : CLOCK_NOW_MIN;
  const start = shift1(SAVED_SHIFTS)?.startMin ?? 8 * 60;
  const caption = productionDayCaption(minute, start);
  const kpis = todayKpis(minute, start);
  const shift = shiftAt(SAVED_SHIFTS, minute);
  const baki = bakiGrams(BHAVESH_ORDER.orderedG, BHAVESH_ORDER.dispatchedG);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PlatformLinks current="today" />
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-[13px] font-medium text-muted-foreground">
            {PLANT.name} · {PLANT.city} · {PLANT.timezone}
          </p>
          <p className="m-0 text-[15px]">
            <span className="text-muted-foreground">Calendar date </span>
            <span className="font-semibold tabular-nums">24 Oct</span>
          </p>
          <p className="m-0 font-display text-[22px] font-bold leading-tight tracking-[-0.03em]" role="status">
            {caption}
          </p>
          <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <span className="tabular-nums">Clock {pretend ? "07:30" : "14:22"}</span>
            {shift ? <Chip tone={shift.name === "Day" ? "green" : "blue"}>{shiftChromeName(shift.name, chrome)}</Chip> : null}
          </p>
        </div>
        <Button type="button" variant={pretend ? "primary" : "secondary"} aria-pressed={pretend} onClick={() => setPretend((on) => !on)}>
          Pretend it is 07:30
        </Button>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <StatusBlock tone="green" title="kg packed" value={kpis.packedGrams / 1000} unit="kg" format={kgFormat} meta="This production day" countUp={false} />
        <StatusBlock tone="blue" title="Bundles" value={kpis.bundleCount} format={(n) => n.toLocaleString("en-IN")} meta="Packed this production day" countUp={false} />
        <StatusBlock tone="amber" title="kg dispatched" value={kpis.dispatchedGrams / 1000} unit="kg" format={kgFormat} meta="Left stock this production day" countUp={false} />
        <StatusBlock tone="neutral" title={chrome.stock} value={kpis.stockGrams / 1000} unit="kg" format={kgFormat} meta="In stock" countUp={false} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3 [&>*]:min-w-0">
        <ActionTile tone="green" title="Pack" hint={`${kpis.bundleCount} bundles · ${formatKg(kpis.packedGrams)} kg`} icon={<PackagePlus />} to="/pack" />
        <ActionTile
          tone="blue"
          title={chrome.dispatch}
          hint={`${formatKg(kpis.dispatchedGrams)} kg`}
          icon={<Truck />}
          to="/dispatch"
        />
        <ActionTile
          tone="amber"
          title="Orders"
          hint={`baki ${formatKgAuto(baki)} kg on ${BHAVESH.name.split(" ")[0] ?? BHAVESH.name}`}
          icon={<FileText />}
          to="/preview/platform/portal"
        />
      </div>
    </div>
  );
}
