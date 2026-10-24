import { Button } from "@orrn/ui/components/button";
import { Card, CardContent } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { ScanField } from "@orrn/ui/components/scan-field";
import { dispatchTone } from "@orrn/domain";
import { cn } from "@orrn/ui/lib/utils";
import { Camera } from "lucide-react";
import { useState } from "react";

import { Fact, FactGrid } from "./facts";
import {
  BUNDLES,
  DISPATCH,
  DISPATCH_OPENING,
  SALES_ORDER,
  SCAN_SCRIPT,
  capacityPercent,
  dieFor,
  formatKg2,
  formatKgWhole,
  formatPercent,
  kgPer12ftAt,
  overCapacity,
  sectionLabel,
  sumKg,
  type BundleFixture,
  type ScanStep,
} from "./fixtures";

type ScanRow = BundleFixture & { justAdded: boolean };

type ScanNotice =
  | { kind: "added"; serial: string }
  | { kind: "refuse"; serial: string; reason: string };

export function DispatchScan() {
  const [rows, setRows] = useState<ScanRow[]>(() =>
    DISPATCH_OPENING.map((bundle) => ({ ...bundle, justAdded: false })),
  );
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState<ScanNotice | null>(null);

  const totalKg = sumKg(rows.map((row) => row.weightKg));
  const over = overCapacity(totalKg, DISPATCH.capacityKg);
  const next = SCAN_SCRIPT[cursor % SCAN_SCRIPT.length]!;
  const filled = capacityPercent(totalKg, DISPATCH.capacityKg);

  const onScan = (_raw: string) => {
    const step = SCAN_SCRIPT[cursor % SCAN_SCRIPT.length]!;
    setCursor((current) => current + 1);
    if (step.kind === "add") {
      const exists = rows.some((row) => row.serial === step.serial);
      if (exists) {
        setNotice({ kind: "refuse", serial: step.serial, reason: "Already in this dispatch" });
        setRows((current) => current.map((row) => ({ ...row, justAdded: false })));
        return;
      }
      setRows((current) => [
        ...current.map((row) => ({ ...row, justAdded: false })),
        { ...rowFromStep(step), justAdded: true },
      ]);
      setNotice({ kind: "added", serial: step.serial });
      return;
    }
    setRows((current) => current.map((row) => ({ ...row, justAdded: false })));
    setNotice({ kind: "refuse", serial: step.serial, reason: step.reason });
  };

  const pop = (serial: string) => {
    setRows((current) => current.filter((row) => row.serial !== serial));
  };

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-24">
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={dispatchTone("draft")}>Building</Chip>
            <span className="font-mono text-[13px] text-muted-foreground">{DISPATCH.code}</span>
          </div>
          <FactGrid>
            <Fact label="Customer" value={DISPATCH.customer} />
            <Fact label="Transporter" value={DISPATCH.transporter} />
            <Fact label="Vehicle" value={DISPATCH.vehicleNo} mono />
            <Fact label="Capacity" value={`${formatKgWhole(DISPATCH.capacityKg)} kg`} mono />
          </FactGrid>
          <p className="m-0 text-[13px] text-muted-foreground">
            At the bay: {BUNDLES.j4089.serial} · party {BUNDLES.j4089.partyNo} ·{" "}
            {formatKg2(BUNDLES.j4089.weightKg)} kg. The first scan puts it on the truck.
          </p>
        </CardContent>
      </Card>

      <ScanField
        label="Scan a bundle label"
        placeholder="Scan a bundle label"
        onScan={onScan}
        autoFocus
        className="max-sm:hidden"
      />
      <Button
        variant="secondary"
        className="hidden max-sm:flex w-full"
        onPress={() => onScan("camera")}
      >
        <Camera aria-hidden="true" />
        Scan with the camera
      </Button>

      <div role="status" aria-live="polite" className="min-h-6">
        {notice ? (
          <p
            className={cn(
              "m-0 text-[15px] font-semibold",
              notice.kind === "refuse" ? "text-destructive" : "text-foreground",
            )}
          >
            <span className="font-mono">{notice.serial}</span>
            {" · "}
            {notice.kind === "added" ? "Added" : notice.reason}
          </p>
        ) : (
          <p className="m-0 text-[13px] text-muted-foreground">
            Scan a bundle label to see how the gate responds.
          </p>
        )}
      </div>

      {over ? (
        <p
          role="status"
          className="m-0 rounded-card border border-border bg-tone-amber-tint px-3 py-2 text-[15px] font-semibold text-tone-amber-ink"
        >
          Over the vehicle capacity
        </p>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row) => (
          <ScanRowCard key={row.serial} row={row} onPop={() => pop(row.serial)} />
        ))}
        <li className="rounded-card border border-dashed border-border bg-surface-sunken px-4 py-3 text-[14px] text-muted-foreground">
          <span className="font-semibold text-foreground">Next scan. </span>
          <span className="font-mono">{next.serial}</span>
        </li>
      </ul>

      <div
        className={cn(
          "sticky bottom-[var(--shell-tabbar-offset)] z-10 flex flex-wrap items-end justify-between gap-3 rounded-card border px-4 py-3 shadow-md backdrop-blur-md",
          over
            ? "border-transparent bg-tone-amber-tint text-tone-amber-ink"
            : "border-border bg-card/95 text-foreground",
        )}
      >
        <div className="min-w-0">
          <p className="m-0 font-mono text-[22px] font-semibold tabular-nums">
            {formatKg2(totalKg)} kg of {formatKgWhole(DISPATCH.capacityKg)}
          </p>
          <p className={cn("m-0 text-[13px]", over ? "text-tone-amber-ink" : "text-muted-foreground")}>
            {formatPercent(filled)}% of capacity
            {over ? " · reason needed before dispatch" : ""}
          </p>
        </div>
        <p className="m-0 text-[13px] tabular-nums">{rows.length} bundles</p>
      </div>
    </div>
  );
}

function rowFromStep(step: Extract<ScanStep, { kind: "add" }>): ScanRow {
  return {
    serial: step.serial,
    partyNo: step.partyNo,
    dieCode: step.dieCode,
    lengthFt: step.lengthFt,
    pieces: step.pieces,
    weightKg: step.weightKg,
    allocation: "order",
    salesOrderCode: SALES_ORDER.code,
    packedSalesOrderCode: SALES_ORDER.code,
    customer: DISPATCH.customer,
    yard: "Y2",
    heldBy: null,
    justAdded: true,
  };
}

function ScanRowCard({ row, onPop }: { row: ScanRow; onPop: () => void }) {
  const die = dieFor(row.dieCode);
  const kg12 = kgPer12ftAt(row.weightKg, row.pieces, row.lengthFt);
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-card border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        row.justAdded ? "border-foreground" : "border-border",
      )}
    >
      <div className="min-w-0">
        <p className="m-0 font-mono text-[17px] font-semibold">{row.serial}</p>
        <p className="m-0 text-[13px] text-muted-foreground">
          Party {row.partyNo} · {sectionLabel(die)} · {row.lengthFt} ft
          {kg12 !== null ? ` · ${formatKg2(kg12)} kg/12 ft` : ""}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <p className="m-0 font-mono text-[17px] font-semibold tabular-nums">{formatKg2(row.weightKg)} kg</p>
        <Button variant="secondary" onPress={onPop} aria-label={`Remove ${row.serial} from this dispatch`}>
          Remove
        </Button>
      </div>
    </li>
  );
}
