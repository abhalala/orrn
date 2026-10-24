import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";
import {
  CUSTOMERS,
  PLAN_WINDOW,
  customerName,
  dieByCode,
  formatOrderKg,
  formatPcs,
  orderGrams,
  lengthLabel,
  lightestCopy,
  type PlanableLine,
} from "@/features/preview/orders/fixtures";
import {
  addPlanLine,
  cancelPlan,
  markRunStarted,
  moveDie,
  planableLines,
  releasePlan,
  removePlanLine,
  so12PlanNote,
  sortedDies,
  toggleUrgent,
  useOrdersDemo,
  type PlanDie,
} from "@/features/preview/orders/store";

const mod = previewModule("orders")!;

export const Route = createFileRoute("/_tenant/preview/orders/plan")({
  component: PressPlanPreview,
});

function PressPlanPreview() {
  const demo = useOrdersDemo();
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const dies = sortedDies(demo);
  const lines = planableLines(demo);
  const stock = so12PlanNote(demo);
  const released = demo.planStatus === "released";

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (customerId !== "all" && line.customerId !== customerId) return false;
      if (!q) return true;
      return (
        line.orderNumber.toLowerCase().includes(q) ||
        line.customerName.toLowerCase().includes(q) ||
        line.sectionCode.toLowerCase().includes(q) ||
        line.poNumber.toLowerCase().includes(q)
      );
    });
  }, [customerId, lines, query]);

  const bothPartiesOn12170 = dies.some(
    (die) =>
      die.sectionCode === "12170" &&
      die.lines.some((line) => line.customerName.startsWith("Bhavesh")) &&
      die.lines.some((line) => line.customerName.startsWith("Anshu")),
  );

  return (
    <PreviewFrame
      title="Press plan"
      summary={PLAN_WINDOW.label}
      featureIds={["FP-OP-11", "FP-OP-12", "FP-OP-13", "FP-OP-15", "FP-OP-16"]}
      specPath={mod.specPath}
      actions={
        <>
          <Button variant="secondary" asChild>
            <Link to="/preview/orders">Orders</Link>
          </Button>
          {released ? (
            <Button variant="secondary" onClick={() => setReleaseError(cancelPlan())}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setSheetOpen(true)} disabled={dies.length === 0}>
              Release to the press
            </Button>
          )}
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono tabular-nums">PP-3 · {released ? "Released" : "Draft"}</CardTitle>
          </CardHeader>
          <p className="m-0 text-[14px] leading-5">{PLAN_WINDOW.label}</p>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{PLAN_WINDOW.detail}</p>
          <div className="flex flex-wrap items-center gap-2">
            {released ? <Chip tone="green">Released</Chip> : <Chip tone="amber">Draft</Chip>}
            <span className="text-[13px] text-muted-foreground">Window is 24 hours</span>
          </div>
          {releaseError ? (
            <p role="status" className="m-0 text-[14px] font-medium leading-5 text-destructive">
              {releaseError}
            </p>
          ) : null}
          {demo.planError ? (
            <p role="status" className="m-0 text-[14px] font-medium leading-5 text-destructive">
              {demo.planError}
            </p>
          ) : null}
        </Card>

        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3">
            <h2 className="m-0 text-[15px] font-semibold">Open lines</h2>
            <div className="flex flex-wrap gap-2">
              <Input
                value={query}
                onChangeText={setQuery}
                placeholder="Die, party, or PO"
                aria-label="Search planable lines"
                className="min-w-[12rem] flex-1"
              />
              <NativeSelect
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                aria-label="Customer"
                className="min-w-[12rem] flex-1"
              >
                <option value="all">All customers</option>
                {CUSTOMERS.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {visible.length === 0 ? (
              <EmptyState title="Nothing left to plan" body="Open lines are in stock or already on a plan." />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {visible.map((line) => (
                  <li key={line.key}>
                    <PlanableCard
                      line={line}
                      otherLines={lines}
                      disabled={released}
                      onAdd={() => setReleaseError(addPlanLine(line.key))}
                    />
                  </li>
                ))}
              </ul>
            )}
            <details className="rounded-card border border-border bg-card p-4">
              <summary className="min-h-11 cursor-pointer text-[15px] font-semibold">Already in stock</summary>
              <p className="m-0 mt-2 text-[14px] leading-5">
                SO-12 · Anshu Aluminium · PO AN-1842 · 4521 · 12 ft · {formatOrderKg(stock.kgG)} kg · {formatPcs(stock.pcs)} pcs
                in stock. Planable {formatOrderKg(stock.planableG)} kg. Not offered.
              </p>
            </details>
          </section>

          <section className="flex min-w-0 flex-col gap-3">
            <h2 className="m-0 text-[15px] font-semibold">Tonight's dies</h2>
            {dies.length === 0 ? (
              <>
                <div className="md:hidden">
                  <EmptyState title="Add a line above" body="One die groups every party that needs it." />
                </div>
                <div className="hidden md:block">
                  <EmptyState title="Choose lines from the left" body="One die groups every party that needs it." />
                </div>
              </>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {dies.map((die, index) => (
                  <li key={die.sectionCode}>
                    <DieCard
                      die={die}
                      index={index}
                      count={dies.length}
                      locked={released}
                      manual={demo.planManualOrder}
                    />
                  </li>
                ))}
              </ul>
            )}
            {demo.planManualOrder ? (
              <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                You set the order. Urgent no longer jumps the queue.
              </p>
            ) : null}
          </section>
        </div>

        {demo.planRuns.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Queued runs</CardTitle>
            </CardHeader>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {demo.planRuns.map((run) => (
                <li key={run.number} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 font-mono text-[15px] font-semibold tabular-nums">
                      {run.number} · {run.name}
                    </p>
                    <p className="m-0 text-[13px] text-muted-foreground">
                      {run.started ? "Started" : "Queued"} · Copy not issued yet
                    </p>
                  </div>
                  {run.started ? (
                    <Chip tone="blue">Started</Chip>
                  ) : (
                    <Button variant="secondary" onClick={() => markRunStarted(run.number)}>
                      Mark started (demo)
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Release PP-3"
        description="The die room picks the copy at issue. This does not lock one."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSheetOpen(false)}>
              Back
            </Button>
            <Button
              onClick={() => {
                const message = releasePlan();
                setReleaseError(message);
                if (!message) setSheetOpen(false);
              }}
            >
              Release
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {dies.map((die, index) => {
            const catalogue = dieByCode(die.sectionCode);
            const suggested = catalogue ? lightestCopy(catalogue) : null;
            return (
              <section key={die.sectionCode} className="flex min-w-0 flex-col gap-2">
                <h3 className="m-0 font-mono text-[15px] font-semibold tabular-nums">
                  {index + 1}. {die.name}
                  {die.urgent ? " · Urgent" : ""}
                </h3>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {die.lines.map((line) => (
                    <li key={line.key} className="text-[14px] leading-5">
                      {line.customerName}
                      {line.poNumber ? ` · PO ${line.poNumber}` : ""} · {lengthLabel(line.lengthFt)} · {formatPcs(line.pcs)} pcs ·{" "}
                      {formatOrderKg(line.kgG)} kg
                    </li>
                  ))}
                </ul>
                {suggested ? (
                  <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                    Die room would issue {suggested.code} (lightest in band).
                  </p>
                ) : null}
              </section>
            );
          })}
          {bothPartiesOn12170 ? (
            <p className="m-0 text-[14px] leading-5">
              Copy 12170-2 is owned by Bhavesh Traders. Die room cannot issue that copy to Anshu Aluminium.
            </p>
          ) : (
            <OtherPartyNotes dies={dies} />
          )}
        </div>
      </Sheet>
    </PreviewFrame>
  );
}

/**
 * The die room cannot issue a copy owned by another customer. On the
 * owner's own line, name the other open PO on the same die instead — the
 * owner's line is not blocked.
 */
function ownerNoteFor(line: PlanableLine, otherLines: readonly PlanableLine[]): string | null {
  const die = dieByCode(line.sectionCode);
  const ownedCopy = die?.copies.find((c) => c.ownerCustomerId != null) ?? null;
  if (!die || !ownedCopy) return null;
  if (line.customerId === ownedCopy.ownerCustomerId) {
    const other = otherLines.find((l) => l.sectionCode === line.sectionCode && l.customerId !== line.customerId);
    if (!other) return null;
    return `${line.sectionName} is also open on ${other.customerName}, PO ${other.poNumber}, balance ${formatOrderKg(other.kgG)} kg.`;
  }
  return `Die room cannot issue copy ${ownedCopy.code} (${customerName(ownedCopy.ownerCustomerId)}) to ${line.customerName}.`;
}

function PlanableCard({
  line,
  otherLines,
  disabled,
  onAdd,
}: {
  line: PlanableLine;
  otherLines: readonly PlanableLine[];
  disabled: boolean;
  onAdd: () => void;
}) {
  const note = ownerNoteFor(line, otherLines);
  return (
    <Card size="sm" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[15px] font-semibold tabular-nums">{line.sectionName}</p>
          <p className="m-0 text-[14px] leading-5">
            {line.orderNumber} · {line.customerName}
            {line.poNumber ? ` · PO ${line.poNumber}` : ""}
          </p>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">
            {lengthLabel(line.lengthFt)} · {formatPcs(line.pcs)} pcs / {formatOrderKg(line.kgG)} kg planable
          </p>
          {line.standIn ? (
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">Booking — confirm before planning.</p>
          ) : null}
          {note ? <p className="m-0 text-[13px] leading-5">{note}</p> : null}
        </div>
        <Button variant="secondary" onClick={onAdd} disabled={disabled}>
          Add
        </Button>
      </div>
    </Card>
  );
}

function DieCard({
  die,
  index,
  count,
  locked,
  manual,
}: {
  die: PlanDie;
  index: number;
  count: number;
  locked: boolean;
  manual: boolean;
}) {
  return (
    <Card size="sm" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[15px] font-semibold tabular-nums">{die.name}</p>
          <p className="m-0 text-[13px] text-muted-foreground">
            {manual ? `Order ${index + 1}` : die.urgent ? "Urgent · runs first" : `Order ${index + 1}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={die.urgent ? "primary" : "secondary"} onClick={() => toggleUrgent(die.sectionCode)} disabled={locked}>
            {die.urgent ? "Urgent" : "Mark urgent"}
          </Button>
          <Button variant="secondary" onClick={() => moveDie(die.sectionCode, -1)} disabled={locked || index === 0}>
            Move earlier
          </Button>
          <Button variant="secondary" onClick={() => moveDie(die.sectionCode, 1)} disabled={locked || index === count - 1}>
            Move later
          </Button>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {die.lines.map((line) => (
          <li key={line.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
            <div className="min-w-0">
              <p className="m-0 text-[14px] leading-5">
                {line.customerName}
                {line.poNumber ? ` · ${line.poNumber}` : ""}
              </p>
              <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
                {line.orderNumber} · {lengthLabel(line.lengthFt)} · {formatPcs(line.pcs)} pcs · {formatOrderKg(line.kgG)} kg
              </p>
            </div>
            <Button variant="ghost" onClick={() => removePlanLine(line.key)} disabled={locked}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OtherPartyNotes({ dies }: { dies: PlanDie[] }) {
  const die = dies.find((item) => item.sectionCode === "12170");
  if (!die) return null;
  const names = new Set(die.lines.map((line) => line.customerName));
  const notes: string[] = [];
  if (!names.has("Anshu Aluminium")) {
    notes.push(`12170 is also open on Anshu Aluminium, PO AN-1901, balance ${formatOrderKg(orderGrams(80, 14, 5_967))} kg.`);
  }
  if (!names.has("Bhavesh Traders")) {
    notes.push(`12170 is also open on Bhavesh Traders, PO BH-2026-121, balance ${formatOrderKg(orderGrams(200, 12, 5_967))} kg.`);
  }
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {notes.map((note) => (
        <p key={note} className="m-0 text-[14px] leading-5">
          {note}
        </p>
      ))}
    </div>
  );
}
