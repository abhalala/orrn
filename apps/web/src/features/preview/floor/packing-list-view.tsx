import { Button } from "@orrn/ui/components/button";
import { Card, CardContent } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { useState } from "react";

import { Fact, FactGrid } from "./facts";
import {
  COMBINE_DISPATCH,
  CUSTOMERS,
  DISPATCH,
  INITIAL_PL_LINES,
  PACKING_LIST,
  PLANT,
  combineLine,
  dieFor,
  formatCount,
  formatKg2,
  kgPer12ftAt,
  plSummary,
  sectionLabel,
  sortPlLines,
  sumKg,
  type PlLine,
} from "./fixtures";

type Revision = {
  n: number;
  lines: PlLine[];
  branding: boolean;
  originalSo: boolean;
};

export function PackingListView() {
  const [revisions, setRevisions] = useState<Revision[]>([
    { n: 1, lines: [...INITIAL_PL_LINES], branding: true, originalSo: true },
  ]);
  const [view, setView] = useState(1);
  const [status, setStatus] = useState<string | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [combineOpen, setCombineOpen] = useState(false);

  const current = revisions[revisions.length - 1]!;
  const shown = revisions.find((revision) => revision.n === view) ?? current;
  const readOnly = shown.n !== current.n;
  const lines = sortPlLines(shown.lines);
  const summary = plSummary(lines);
  const totalKg = sumKg(lines.map((line) => line.weightKg));
  const totalPcs = lines.reduce((sum, line) => sum + line.pieces, 0);

  const patchCurrent = (patch: Partial<Pick<Revision, "branding" | "originalSo" | "lines">>) => {
    setRevisions((list) =>
      list.map((revision) => (revision.n === current.n ? { ...revision, ...patch } : revision)),
    );
    setView(current.n);
  };

  const confirmRegen = () => {
    const next: Revision = {
      n: current.n + 1,
      lines: current.lines.map((line) => ({ ...line })),
      branding: current.branding,
      originalSo: current.originalSo,
    };
    setRevisions((list) => [...list, next]);
    setView(next.n);
    setRegenOpen(false);
    setStatus(null);
  };

  const confirmCombine = () => {
    const extra = combineLine();
    if (current.lines.some((line) => line.serial === extra.serial)) {
      setCombineOpen(false);
      setView(current.n);
      return;
    }
    patchCurrent({ lines: [...current.lines, extra] });
    setCombineOpen(false);
    setStatus(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card>
        <CardContent className="gap-4">
          {shown.branding ? (
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-card bg-foreground font-display text-[15px] font-bold text-background">
                FC
              </span>
              <p className="m-0 text-[13px] text-muted-foreground">Extrusions · Surat</p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">
                {PLANT.name}, {PLANT.city}
              </p>
              <p className="m-0 text-[15px] text-muted-foreground">{DISPATCH.customer}</p>
            </div>
            <p className="m-0 font-mono text-[17px] font-semibold">{PACKING_LIST.code}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {revisions.map((revision) => (
              <button
                key={revision.n}
                type="button"
                onClick={() => setView(revision.n)}
                aria-current={revision.n === view ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-semibold",
                  revision.n === view
                    ? "bg-foreground text-background"
                    : "border border-border bg-card text-foreground",
                )}
              >
                Revision {revision.n}
              </button>
            ))}
          </div>
          {readOnly ? (
            <p
              role="status"
              className="m-0 rounded-card border border-border bg-surface-sunken px-3 py-2 text-[14px] font-semibold"
            >
              Sent copy
            </p>
          ) : null}
          <FactGrid>
            <Fact label="Date" value={PLANT.dateLabel} />
            <Fact label="Vehicle" value={DISPATCH.vehicleNo} mono />
            <Fact label="Transporter" value={DISPATCH.transporter} />
            <Fact label="Bundles" value={formatCount(lines.length)} />
            <Fact label="Pieces" value={formatCount(totalPcs)} />
            <Fact label="Weight" value={`${formatKg2(totalKg)} kg`} mono />
          </FactGrid>
          <p className="m-0 text-[13px] text-muted-foreground">
            {CUSTOMERS.bhavesh.name} restarts bundle numbers monthly. Next party number{" "}
            {CUSTOMERS.bhavesh.nextPartyNo}. The scan serial stays the plant number.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-3">
          <h2 className="m-0 text-[15px] font-semibold">Summary</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {summary.map((row) => (
              <li key={row.kind} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold capitalize">{row.kind}</span>
                <span className="font-mono text-[14px] tabular-nums">
                  {formatCount(row.bundles)} {row.bundles === 1 ? "bundle" : "bundles"}, {formatCount(row.pieces)} pcs,{" "}
                  {formatKg2(row.kg)} kg
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {groupLines(lines).map((group) => (
          <section key={group.dieCode} className="flex min-w-0 flex-col gap-2">
            <h2 className="m-0 text-[15px] font-semibold">
              {group.dieCode} {group.series}
            </h2>
            <div className="flex flex-col gap-2 md:hidden">
              {group.lines.map((line, index) => (
                <LineCard key={line.serial} line={line} index={index} showOriginal={shown.originalSo} />
              ))}
            </div>
            <div className="hidden min-w-0 overflow-x-auto md:block">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <caption className="sr-only">
                  {group.dieCode} {group.series}
                </caption>
                <thead>
                  <tr className="border-b border-border text-[13px] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Sr</th>
                    <th className="py-2 pr-3 font-medium">Bundle no</th>
                    <th className="py-2 pr-3 font-medium">Section</th>
                    <th className="py-2 pr-3 font-medium">Cut</th>
                    <th className="py-2 pr-3 text-right font-medium">Pcs</th>
                    <th className="py-2 pr-3 text-right font-medium">kg</th>
                    <th className="py-2 pr-3 text-right font-medium">kg/12 ft</th>
                    {shown.originalSo ? <th className="py-2 font-medium">Original sales order</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line, index) => (
                    <LineCells key={line.serial} line={line} index={index} showOriginal={shown.originalSo} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 text-[13px] font-semibold tabular-nums text-muted-foreground">
              {group.dieCode} subtotal · {formatCount(group.lines.reduce((sum, line) => sum + line.pieces, 0))} pcs ·{" "}
              {formatKg2(sumKg(group.lines.map((line) => line.weightKg)))} kg
            </p>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={readOnly}
          aria-pressed={shown.branding}
          onPress={() => patchCurrent({ branding: !current.branding })}
        >
          Branding {shown.branding ? "on" : "off"}
        </Button>
        <Button
          variant="secondary"
          disabled={readOnly}
          aria-pressed={shown.originalSo}
          onPress={() => patchCurrent({ originalSo: !current.originalSo })}
        >
          Original sales order {shown.originalSo ? "on" : "off"}
        </Button>
        <Button variant="secondary" onPress={() => setStatus("Preview only")}>
          PDF
        </Button>
        <Button variant="secondary" onPress={() => setStatus("Preview only")}>
          Excel
        </Button>
        <Button variant="secondary" onPress={() => setRegenOpen(true)}>
          Regenerate
        </Button>
        <Button variant="secondary" onPress={() => setCombineOpen(true)}>
          Combine
        </Button>
      </div>
      {status ? (
        <p role="status" className="m-0 text-[15px] font-semibold">
          {status}
        </p>
      ) : null}

      <Dialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        title="Regenerate the packing list?"
        description="The previous revision is kept. The packing list number does not change."
        actions={
          <>
            <Button variant="secondary" onPress={() => setRegenOpen(false)}>
              Cancel
            </Button>
            <Button onPress={confirmRegen}>Regenerate</Button>
          </>
        }
      >
        <p className="m-0 text-[14px] text-muted-foreground">
          Revision {current.n} stays as the copy already sent. The new revision uses the same rows.
        </p>
      </Dialog>

      <Sheet
        open={combineOpen}
        onOpenChange={setCombineOpen}
        title="Combine a dispatch"
        description="Same customer only. The earlier list is kept and marked combined."
        footer={
          <>
            <Button variant="secondary" onPress={() => setCombineOpen(false)}>
              Cancel
            </Button>
            <Button onPress={confirmCombine}>Combine</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 rounded-card border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold">{COMBINE_DISPATCH.code}</span>
            <Chip tone="green">Dispatched</Chip>
          </div>
          <p className="m-0 text-[14px]">{COMBINE_DISPATCH.customer}</p>
          <p className="m-0 text-[14px] text-muted-foreground">
            One line · {sectionLabel(dieFor(COMBINE_DISPATCH.line.dieCode))} · {COMBINE_DISPATCH.line.lengthFt} ft ·{" "}
            {COMBINE_DISPATCH.line.pieces} pcs · {formatKg2(COMBINE_DISPATCH.line.weightKg)} kg · party{" "}
            {COMBINE_DISPATCH.line.partyNo}
          </p>
        </div>
      </Sheet>
    </div>
  );
}

function groupLines(lines: readonly PlLine[]): { dieCode: string; series: string; lines: PlLine[] }[] {
  const groups: { dieCode: string; series: string; lines: PlLine[] }[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.dieCode === line.dieCode) last.lines.push(line);
    else groups.push({ dieCode: line.dieCode, series: line.series, lines: [line] });
  }
  return groups;
}

function LineCard({
  line,
  index,
  showOriginal,
}: {
  line: PlLine;
  index: number;
  showOriginal: boolean;
}) {
  const kg12 = kgPer12ftAt(line.weightKg, line.pieces, line.lengthFt);
  return (
    <article className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-4">
      <p className="m-0 font-mono text-[17px] font-semibold">{line.partyNo}</p>
      <p className="m-0 text-[13px] text-muted-foreground">
        {index + 1} · {line.dieCode} {line.series} · {line.lengthFt} ft · {line.pieces} pcs ·{" "}
        {formatKg2(line.weightKg)} kg
        {kg12 !== null ? ` · ${formatKg2(kg12)} kg/12 ft` : ""}
      </p>
      {showOriginal && line.originalSo ? (
        <p className="m-0 font-mono text-[13px]">{line.originalSo}</p>
      ) : null}
    </article>
  );
}

function LineCells({
  line,
  index,
  showOriginal,
}: {
  line: PlLine;
  index: number;
  showOriginal: boolean;
}) {
  const kg12 = kgPer12ftAt(line.weightKg, line.pieces, line.lengthFt);
  return (
    <tr className="border-b border-border">
      <td className="py-2.5 pr-3 tabular-nums">{index + 1}</td>
      <td className="py-2.5 pr-3 font-mono font-semibold">{line.partyNo}</td>
      <td className="py-2.5 pr-3 font-mono">
        {line.dieCode} {line.series}
      </td>
      <td className="py-2.5 pr-3 tabular-nums">{line.lengthFt} ft</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{line.pieces}</td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{formatKg2(line.weightKg)}</td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{kg12 === null ? "—" : formatKg2(kg12)}</td>
      {showOriginal ? <td className="py-2.5 font-mono">{line.originalSo ?? "—"}</td> : null}
    </tr>
  );
}
