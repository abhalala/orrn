import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { ResponsiveList } from "@orrn/ui/components/responsive-list";
import { Tabs } from "@orrn/ui/components/tabs";
import { lazy, Suspense, useState } from "react";

import { BandPositionChip, PercentChip, StatusChip } from "./drift-chips";
import {
  FILES_12170,
  NITRIDING_12170_1,
  RUNS_12170_1,
  accumulatedOutG,
  bandPosition,
  closeGrams,
  copyByCode,
  driftTone,
  effectiveBand,
  formatBandRange,
  formatBytes,
  formatGrams,
  formatKgPerM,
  formatMilliKg,
  formatPctTenth,
  formatRecovery,
  formatSpeed,
  formatWallMm,
  latestMilli,
  lifeLine,
  lifeReached,
  pctTenth,
  producedGrams,
  profileLabel,
  type WeightReading,
} from "./fixtures";
import { ReadingPad } from "./reading-pad";
import { PreviewLink } from "./screen-links";
import { SectionOutline } from "./section-outline";

const TABS = [
  { id: "readings", label: "Readings" },
  { id: "runs", label: "Runs" },
  { id: "nitriding", label: "Nitriding" },
  { id: "tier", label: "Tier" },
  { id: "maker", label: "Maker" },
  { id: "files", label: "Files" },
];

const ReadingTrend = lazy(() => import("./reading-trend").then((mod) => ({ default: mod.ReadingTrend })));

export function DieCardScreen() {
  const { section, copy } = copyByCode("12170-1");
  const band = effectiveBand(section, copy);
  const [extra, setExtra] = useState<WeightReading | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [tab, setTab] = useState("readings");
  const [downloadNote, setDownloadNote] = useState<string | null>(null);

  const readings = extra ? [...copy.readings, extra] : copy.readings;
  const latest = readings[readings.length - 1]?.kgPer12ftMilli ?? null;
  const tone = driftTone(latest, band.weightMinG);
  const position = bandPosition(latest, band);
  const tenth = latest === null ? null : pctTenth(latest, band.weightMinG);
  const produced = producedGrams(RUNS_12170_1);
  const life = copy.lifeG ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[32px] font-semibold leading-none tabular-nums tracking-[-0.03em]">{copy.code}</p>
          <p className="m-0 mt-2 text-[15px] leading-6 text-muted-foreground">
            {section.series} · {profileLabel(section.profileKind)} · {section.alloy} {section.temper} · Tier {copy.tierRank}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={copy.status} />
          <Button onClick={() => setPadOpen(true)}>Add reading</Button>
          {extra ? (
            <Button variant="secondary" onClick={() => setExtra(null)}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-2" aria-live="polite">
        <p className="m-0 font-mono text-[40px] font-semibold leading-none tabular-nums">
          {latest === null ? "No reading" : formatMilliKg(latest)}
          {latest !== null ? <span className="ml-2 text-[15px] font-medium text-muted-foreground">kg/12 ft</span> : null}
        </p>
        {latest !== null ? (
          <p
            className="m-0 font-mono text-[20px] font-semibold tabular-nums"
            title={`${formatMilliKg(latest)} ÷ (12 × 0.3048)`}
          >
            {formatKgPerM(latest)} kg/m
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {tenth !== null ? <PercentChip tone={tone} label={formatPctTenth(tenth)} /> : null}
        <BandPositionChip position={position} />
        <Badge tone="neutral" className="font-mono tabular-nums">
          {formatWallMm(band.wallTenthMm)} mm · {formatBandRange(band)}
        </Badge>
      </div>
      <p className="m-0 text-[15px] font-semibold tabular-nums">
        Life {lifeLine(produced, life)}
        {lifeReached(produced, life) ? ". Life reached" : ""}
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="min-w-0">
          <div className="rounded-card bg-surface-sunken px-3 py-4">
            <SectionOutline />
          </div>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">Section outline. Not a photograph of a die.</p>
          <Button variant="secondary" aria-expanded={drawingOpen} onClick={() => setDrawingOpen((open) => !open)}>
            {drawingOpen ? "Close drawing" : "Open drawing"}
          </Button>
        </Card>
        <Card className="min-w-0">
          <CardTitle>Card</CardTitle>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <Fact label="Cavities" value={String(copy.cavityCount)} />
            <Fact label="Bolster" value={copy.bolster ?? "—"} mono />
            <Fact label="Wall" value={`${formatWallMm(section.wallTenthMm)} mm`} />
            <Fact label="Trial" value={copy.trialMilli === null ? "—" : `${formatMilliKg(copy.trialMilli)} kg/12 ft`} mono />
            <Fact label="HV" value={copy.hardnessHv === null ? "—" : String(copy.hardnessHv)} />
            <Fact label="Rack" value={copy.rackNo ?? "—"} mono />
          </dl>
        </Card>
      </div>

      {drawingOpen ? (
        <Card>
          <p className="m-0 text-[13px] font-semibold text-muted-foreground">{section.drawingFilename}</p>
          <p className="m-0 font-display text-[22px] font-bold leading-tight tracking-[-0.025em]">
            12170 Domal — 1.2 mm wall
          </p>
          <p className="m-0 text-[15px] leading-6">Not to scale. Read the dimensions off the drawing.</p>
          <div className="rounded-card border border-border bg-surface-sunken p-4">
            <SectionOutline className="h-40" />
          </div>
        </Card>
      ) : null}

      <Tabs items={TABS} value={tab} onValueChange={setTab} label="Die card">
        {tab === "readings" ? (
          <ReadingsPanel
            trialMilli={copy.trialMilli}
            readings={readings}
            bandStart={band.weightMinG}
            onAdd={() => setPadOpen(true)}
          />
        ) : null}
        {tab === "runs" ? <RunsPanel /> : null}
        {tab === "nitriding" ? <NitridingPanel /> : null}
        {tab === "tier" ? (
          <Card>
            <CardTitle>Tier {copy.tierRank}</CardTitle>
            <p className="m-0 text-[14px] leading-6 text-muted-foreground">
              No pending tier change. A lift does not change the copy code. 12170-2 is the worn copy.
            </p>
            <PreviewLink to="/preview/die-room/lift" className="text-[15px] font-semibold text-foreground">
              Open lift for 12170-2
            </PreviewLink>
          </Card>
        ) : null}
        {tab === "maker" ? (
          <EmptyState
            title="No maker job"
            body="12170-1 is in use on the press. 12170-3 is out for correction."
            action={
              <PreviewLink to="/preview/die-room/maker" className="text-[15px] font-semibold text-foreground">
                Open maker
              </PreviewLink>
            }
          />
        ) : null}
        {tab === "files" ? (
          <div className="flex flex-col gap-3">
            {FILES_12170.map((file) => (
              <div key={file.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-card border border-border bg-card p-4">
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate font-mono text-[14px] font-semibold">{file.filename}</p>
                  <p className="m-0 text-[13px] text-muted-foreground">
                    {file.kind.toUpperCase()} · {formatBytes(file.bytes)}
                  </p>
                </div>
                {file.pressDrawing ? <Badge tone="info">Press drawing</Badge> : null}
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (file.pressDrawing) {
                      setDrawingOpen(true);
                      setDownloadNote("Not to scale. Read the dimensions off the drawing.");
                      return;
                    }
                    setDownloadNote(`Preview only. ${file.filename} is stored, not opened here.`);
                  }}
                >
                  {file.pressDrawing ? "Open drawing" : "Download"}
                </Button>
              </div>
            ))}
            {downloadNote ? (
              <p role="status" className="m-0 text-[13px] text-muted-foreground">
                {downloadNote}
              </p>
            ) : null}
            <details className="rounded-card border border-border bg-card p-4">
              <summary className="min-h-11 cursor-pointer text-[15px] font-semibold leading-[44px]">Advanced</summary>
              <dl className="m-0 mt-3 grid grid-cols-2 gap-3">
                <Fact label="Backer" value={copy.backerNo ?? "—"} mono />
                <Fact label="Sub-bolster" value={copy.subBolster ?? "—"} mono />
                <Fact label="Corrector" value={copy.corrector ?? "—"} />
                <Fact label="Supplier" value={copy.supplier ?? "—"} />
                <Fact label="Received" value={copy.receivedOn ?? "—"} />
                <Fact label="FTR" value={copy.ftr ?? "FTR"} />
              </dl>
            </details>
          </div>
        ) : null}
      </Tabs>

      <ReadingPad
        open={padOpen}
        onOpenChange={setPadOpen}
        lastMilli={latest}
        band={band}
        onAdd={(milli) =>
          setExtra({
            id: "rd-bench",
            kgPer12ftMilli: milli,
            at: "24 Oct 2026",
            pressRunId: null,
          })
        }
      />
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[14px] tabular-nums" : "m-0 text-[14px] tabular-nums"}>{value}</dd>
    </div>
  );
}

function ReadingsPanel({
  trialMilli,
  readings,
  bandStart,
  onAdd,
}: {
  trialMilli: number | null;
  readings: WeightReading[];
  bandStart: number;
  onAdd: () => void;
}) {
  const points = readings.map((row) => row.kgPer12ftMilli / 1000);
  return (
    <div className="flex flex-col gap-4">
      <div className="pr-2">
        <Suspense fallback={<div className="h-16 rounded-card bg-surface-sunken" aria-busy="true" />}>
          <ReadingTrend points={points} />
        </Suspense>
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {trialMilli !== null ? (
          <li className="rounded-card border border-dashed border-border bg-surface-sunken p-4">
            <p className="m-0 font-mono text-[16px] font-semibold tabular-nums">{formatMilliKg(trialMilli)} kg/12 ft</p>
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">Trial weight. Not a drift reading.</p>
          </li>
        ) : null}
        {readings.map((row) => {
          const tenth = pctTenth(row.kgPer12ftMilli, bandStart);
          return (
            <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-card border border-border bg-card p-4">
              <span className="font-mono text-[16px] font-semibold tabular-nums">{formatMilliKg(row.kgPer12ftMilli)}</span>
              <PercentChip tone={driftTone(row.kgPer12ftMilli, bandStart)} label={formatPctTenth(tenth)} />
              <span className="text-[13px] text-muted-foreground">
                {row.at}
                {row.pressRunId ? ` · ${row.pressRunId}` : " · Bench"}
              </span>
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" onClick={onAdd}>
        Add reading
      </Button>
    </div>
  );
}

function RunsPanel() {
  return (
    <ResponsiveList
      label="Press runs"
      rows={RUNS_12170_1}
      rowKey={(row) => row.id}
      empty={<EmptyState title="No runs" body="Press runs land here from the press, not a second log." />}
      columns={[
        {
          key: "run",
          header: "Run",
          cell: (row) => <span className="font-mono font-semibold tabular-nums">{row.number}</span>,
        },
        { key: "shift", header: "Shift", cell: (row) => row.shift },
        { key: "date", header: "Date", cell: (row) => row.date },
        {
          key: "in",
          header: "In",
          align: "end",
          cell: (row) => <span className="font-mono tabular-nums">{formatMilliKg(row.inG)}</span>,
        },
        {
          key: "out",
          header: "Out",
          align: "end",
          cell: (row) => <span className="font-mono tabular-nums">{formatMilliKg(row.outG)}</span>,
        },
        {
          key: "recovery",
          header: "Recovery",
          align: "end",
          cell: (row) => (
            <span className="tabular-nums">
              {formatMilliKg(row.outG)} ÷ {formatMilliKg(row.inG)} = {formatRecovery(row.outG, row.inG)}
            </span>
          ),
        },
        {
          key: "speed",
          header: "Speed",
          align: "end",
          cell: (row) => <span className="tabular-nums">{formatSpeed(row.speedTenthMmPerS)} mm/s</span>,
        },
        {
          key: "reading",
          header: "Reading",
          cell: (row) => (
            <span className="font-mono tabular-nums">
              {formatMilliKg(row.readingMilli)} ({formatPctTenth(pctTenth(row.readingMilli, 5900))})
            </span>
          ),
        },
        {
          key: "accumulated",
          header: "Accumulated",
          align: "end",
          cell: (row) => (
            <span className="font-mono tabular-nums">{formatMilliKg(accumulatedOutG(RUNS_12170_1, row.id))} kg</span>
          ),
        },
        {
          key: "nitriding",
          header: "Nitriding",
          cell: (row) => row.nitridingDate ?? "—",
        },
        { key: "remark", header: "Remark", cell: (row) => row.remark },
      ]}
    />
  );
}

function NitridingPanel() {
  const row = NITRIDING_12170_1;
  const chemical = row.chemicals[0];
  const close = chemical ? closeGrams(chemical.openG, chemical.usedG) : 0;
  return (
    <Card>
      <CardTitle>{row.date}</CardTitle>
      <p className="m-0 text-[14px] leading-6">HV {row.hardnessHv}. Signed by the die-room user.</p>
      {chemical ? (
        <p className="m-0 font-mono text-[15px] tabular-nums">
          {chemical.name} open {formatGrams(chemical.openG)} / used {formatGrams(chemical.usedG)} / close{" "}
          {formatGrams(close)}
        </p>
      ) : null}
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">
        Close grams = open − used.{" "}
        {chemical
          ? `${chemical.openG.toLocaleString("en-IN")} − ${chemical.usedG.toLocaleString("en-IN")} = ${close.toLocaleString("en-IN")}`
          : ""}{" "}
        g. CR2, K2S and caustic were not drawn.
      </p>
    </Card>
  );
}
