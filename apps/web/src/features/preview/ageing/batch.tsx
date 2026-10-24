import { formatKg, parseDecimal, type StatusTone } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { Card, CardDescription, CardSection, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

import { Fact, FactGrid } from "./bits";
import {
  AG38_GAS_END_MILLI,
  AG38_GAS_START_MILLI,
  AG38_IN_AT,
  AG38_LINES,
  AG38_OUT_AT,
  AG38_TEMPS,
  BATCH_FEATURES,
  BUNDLE_26J12,
  HOLD_REASONS,
  RECIPE_6063_T5,
  SECTIONS,
  TOP_UP_6063_T5,
  formatClock,
  formatCut,
  formatDuration,
  formatGas,
  formatKgFromG,
  formatTemp,
  formatWhen,
  gasUsedMilli,
  hardnessPassed,
  hardnessWarns,
  inTempBand,
  inWeightBand,
  kgPer12,
  lastTemp,
  median,
  minutesBetween,
  remainingPcs,
  soakMinutes,
  soakStartedAt,
  theoreticalRemainingG,
  type AgeingLine,
  type HoldReason,
  type RowStatus,
  type TempReading,
} from "./fixtures";
import { ageingReportTo } from "./paths";

const mod = previewModule("ageing")!;

type LineState = {
  packedPcs: number;
  reworkPcs: number;
  status: RowStatus;
  holdReason: string | null;
};

type LiveLine = AgeingLine & LineState;

function liveOf(line: AgeingLine, state: LineState): LiveLine {
  return { ...line, ...state, scrapPcs: 0 };
}

function batchTone(lines: readonly LiveLine[]): { tone: StatusTone; label: string } {
  if (lines.some((line) => line.status === "released" && remainingPcs(line) > 0)) {
    return { tone: "green", label: "Released" };
  }
  if (lines.some((line) => line.status === "held")) return { tone: "red", label: "Held" };
  return { tone: "blue", label: "Out" };
}

export function AgeingBatch() {
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      AG38_LINES.map((line) => [
        line.id,
        {
          packedPcs: line.packedPcs,
          reworkPcs: line.reworkPcs,
          status: line.status,
          holdReason: line.holdReason,
        },
      ]),
    ),
  );
  const [temps, setTemps] = useState<TempReading[]>(() => [...AG38_TEMPS]);
  const [tempOpen, setTempOpen] = useState(false);
  const [tempText, setTempText] = useState("183");
  const [tempError, setTempError] = useState<string | undefined>();
  const [drawText, setDrawText] = useState("44");
  const [packNote, setPackNote] = useState<string | undefined>();
  const [holdOpen, setHoldOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkNote, setReworkNote] = useState<string | undefined>();

  const live = AG38_LINES.map((line) => liveOf(line, lines[line.id]!));
  const first = live[0]!;
  const second = live[1]!;
  const tee = live[2]!;
  const loaded = live.reduce((sum, line) => sum + line.pcs, 0);
  const packed = live.reduce((sum, line) => sum + line.packedPcs, 0);
  const remaining = live.reduce((sum, line) => sum + remainingPcs(line), 0);
  const packable = live.reduce(
    (sum, line) => sum + (line.status === "released" ? remainingPcs(line) : 0),
    0,
  );
  const held = live.reduce((sum, line) => sum + (line.status === "held" ? remainingPcs(line) : 0), 0);
  const theoreticalG = theoreticalRemainingG(live);
  const soak = soakMinutes(temps, RECIPE_6063_T5, AG38_OUT_AT);
  const soakMet = soak !== null && soak >= RECIPE_6063_T5.soakMin;
  const started = soakStartedAt(temps, RECIPE_6063_T5);
  const last = lastTemp(temps);
  const used = gasUsedMilli(AG38_GAS_START_MILLI, AG38_GAS_END_MILLI);
  const chip = batchTone(live);
  const totalMin = minutesBetween(AG38_IN_AT, AG38_OUT_AT);
  const drawLeft = remainingPcs(first);
  const drawN = parseDecimal(drawText);
  const drawValid = drawN !== null && Number.isInteger(drawN) && drawN >= 1 && drawN <= drawLeft;
  const drawError =
    drawText.trim() === ""
      ? undefined
      : drawN === null || !Number.isInteger(drawN)
        ? "Enter whole pieces."
        : drawN < 1
          ? "Enter at least 1 piece."
          : drawN > drawLeft
            ? `Only ${drawLeft} pcs left.`
            : undefined;

  const draw = (pcs: number) => {
    setLines((prev) => {
      const row = prev[first.id]!;
      const nextPacked = row.packedPcs + pcs;
      const nextRemaining = first.pcs - nextPacked - row.reworkPcs;
      return {
        ...prev,
        [first.id]: {
          ...row,
          packedPcs: nextPacked,
          status: nextRemaining === 0 ? "closed" : row.status,
        },
      };
    });
    setPackNote(`Drawn ${pcs} pcs. The kilogram is weighed, not a theoretical figure.`);
  };

  const addTemp = () => {
    const n = parseDecimal(tempText);
    if (n === null || n <= 0) {
      setTempError("Enter a temperature.");
      return;
    }
    const out = new Date(AG38_OUT_AT).getTime();
    const limit = out + 30 * 60_000;
    const latest = temps.reduce((max, row) => Math.max(max, new Date(row.at).getTime()), out);
    const atMs = Math.max(latest + 5 * 60_000, out + 10 * 60_000);
    if (atMs > limit) {
      setTempError("A reading more than 30 minutes after take-out is refused.");
      return;
    }
    const reading: TempReading = {
      id: `typed-${temps.length + 1}`,
      at: new Date(atMs).toISOString(),
      tempX10: Math.round(n * 10),
      source: "typed",
    };
    setTemps((prev) => [...prev, reading]);
    setTempError(undefined);
    setTempOpen(false);
  };

  const hold = (reason: HoldReason) => {
    setLines((prev) => ({
      ...prev,
      [second.id]: { ...prev[second.id]!, status: "held", holdReason: reason },
    }));
    setHoldOpen(false);
  };

  const rework = () => {
    const left = remainingPcs(tee);
    setLines((prev) => ({
      ...prev,
      [tee.id]: { ...prev[tee.id]!, reworkPcs: prev[tee.id]!.reworkPcs + left },
    }));
    setReworkNote("Successor batch opened on T-2, not saved.");
    setReworkOpen(false);
  };

  return (
    <PreviewFrame
      title="AG-38"
      summary="Trolley T-1 · out of OV-1 · Day shift."
      featureIds={[...BATCH_FEATURES]}
      specPath={mod.specPath}
      actions={
        <Button variant="secondary" asChild>
          <Link to={ageingReportTo}>Ageing report</Link>
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="font-mono tabular-nums">6063-T5</CardTitle>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </div>
          <FactGrid className="sm:grid-cols-3">
            <Fact label="In" value={formatWhen(AG38_IN_AT)} />
            <Fact label="Out" value={formatClock(AG38_OUT_AT)} />
            <Fact
              label="Soak"
              value={`${formatDuration(soak ?? 0)} of ${formatDuration(RECIPE_6063_T5.soakMin)} (${soakMet ? "pass" : "short"})`}
            />
            <Fact
              label="Gas"
              value={`${formatGas(AG38_GAS_START_MILLI)} → ${formatGas(AG38_GAS_END_MILLI)} m³`}
            />
            <Fact label="Used" value={`${formatGas(used)} m³`} />
            <Fact label="Set" value={`${formatTemp(RECIPE_6063_T5.targetTempX10)}°C`} />
          </FactGrid>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">
            Total {formatDuration(totalMin)}.{" "}
            {started
              ? `Soak started at ${formatClock(started)}, the first reading inside ${formatTemp(RECIPE_6063_T5.targetTempX10 - RECIPE_6063_T5.toleranceX10)}–${formatTemp(RECIPE_6063_T5.targetTempX10 + RECIPE_6063_T5.toleranceX10)}°C.`
              : "Soak has not started."}
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusBlock tone="neutral" title="Loaded" meta="Sum of the lines" value={loaded} unit="pcs" countUp={false} />
          <StatusBlock tone="blue" title="Packed" meta="Pieces off the trolley" value={packed} unit="pcs" countUp={false} />
          <StatusBlock tone="green" title="Packable" meta="Released, still on the rack" value={packable} unit="pcs" countUp={false} />
          <StatusBlock tone="red" title="Held" meta="Not on the pack list" value={held} unit="pcs" countUp={false} />
        </div>
        <p className="m-0 text-[14px] leading-6 text-foreground">
          Theoretical still on the rack{" "}
          <span className="font-mono tabular-nums">{formatKgFromG(theoreticalG)} kg</span>. Packed on the scale{" "}
          <span className="font-mono tabular-nums">{formatKgFromG(BUNDLE_26J12.weightG)} kg</span>.
        </p>
        <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
          {loaded} loaded = {packed} packed + {remaining} remaining. Packable {packable} + held {held} ={" "}
          {packable + held}.
        </p>

        <Card>
          <CardSection
            title="Temperature log"
            description={`Last ${last ? `${formatTemp(last.tempX10)}°C` : "—"}. Typed readings. Soak already started, so a later in-band reading does not move it.`}
            actions={
              <Button variant="secondary" onPress={() => setTempOpen(true)}>
                Add reading
              </Button>
            }
          >
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {temps
                .slice()
                .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
                .map((row) => {
                  const inBand = inTempBand(row.tempX10, RECIPE_6063_T5);
                  const opensSoak = started === row.at || (started !== null && new Date(started).getTime() === new Date(row.at).getTime());
                  return (
                    <li key={row.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono tabular-nums text-foreground">
                        {formatClock(row.at)} {formatTemp(row.tempX10)}°C
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        {opensSoak ? "Soak started" : inBand ? "In band" : "Outside band"} · {row.source}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </CardSection>
        </Card>

        <CardSection
          title="Lines"
          description={`${SECTIONS["domal-12170"].label} is ${formatKg(SECTIONS["domal-12170"].minKg, 3)}–${formatKg(SECTIONS["domal-12170"].maxKg, 3)} kg per 12 ft; ${SECTIONS["tee-13090"].label} is ${formatKg(SECTIONS["tee-13090"].minKg, 3)}–${formatKg(SECTIONS["tee-13090"].maxKg, 3)} kg per 12 ft.`}
        >
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <LineCard
              line={first}
              recipeMin={RECIPE_6063_T5.hardnessMinX10}
              footer={
                <div className="flex flex-col gap-3">
                  <p className="m-0 text-[13px] text-muted-foreground">
                    Bundle {BUNDLE_26J12.serial} · {BUNDLE_26J12.pcs} pcs · {formatKgFromG(BUNDLE_26J12.weightG)} kg
                    on the scale. Press run {BUNDLE_26J12.pressRun}, cast {BUNDLE_26J12.cast}.
                  </p>
                  <Field label="Pieces to draw" error={drawError} hint={`${drawLeft} pcs left.`}>
                    <NumberInput value={drawText} onValueChange={setDrawText} decimal={false} suffix="pcs" />
                  </Field>
                  <div className="flex justify-end">
                    <Button
                      size="lg"
                      disabled={!drawValid}
                      onPress={() => {
                        if (drawN === null || !drawValid) return;
                        draw(drawN);
                      }}
                    >
                      {drawValid ? `Pack ${drawN} pcs` : "Pack"}
                    </Button>
                  </div>
                  {packNote ? (
                    <p role="status" className="m-0 text-[13px] text-muted-foreground">
                      {packNote}
                    </p>
                  ) : null}
                </div>
              }
            />
            <LineCard
              line={second}
              recipeMin={RECIPE_6063_T5.hardnessMinX10}
              footer={
                second.status === "released" ? (
                  <Button variant="secondary" onPress={() => setHoldOpen(true)}>
                    Hold
                  </Button>
                ) : (
                  <p className="m-0 text-[13px] text-muted-foreground">
                    Held · {second.holdReason}.
                    {first.status === "released" && remainingPcs(first) > 0
                      ? " The 12 ft line is still released, so the batch stays released."
                      : ""}
                  </p>
                )
              }
            />
            <LineCard
              line={tee}
              recipeMin={RECIPE_6063_T5.hardnessMinX10}
              footer={
                <div className="flex flex-col gap-2">
                  <p className="m-0 text-[13px] text-muted-foreground">Held lines do not reach the pack list.</p>
                  {remainingPcs(tee) > 0 ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button variant="secondary" onPress={() => setReworkOpen(true)}>
                        Rework
                      </Button>
                    </div>
                  ) : null}

                  {reworkNote ? (
                    <p role="status" className="m-0 text-[13px] text-muted-foreground">
                      {reworkNote}
                    </p>
                  ) : null}
                </div>
              }
            />
          </div>
        </CardSection>

        <div>
          <Button variant="secondary" asChild>
            <Link to={ageingReportTo}>Ageing report</Link>
          </Button>
        </div>
      </div>

      <Sheet
        open={tempOpen}
        onOpenChange={setTempOpen}
        title="Add reading"
        description="Typed. A reading inside the recipe band does not restart the soak."
        footer={
          <>
            <Button variant="secondary" onPress={() => setTempOpen(false)}>
              Cancel
            </Button>
            <Button onPress={addTemp}>Add reading</Button>
          </>
        }
      >
        <Field label="Temperature" error={tempError} hint="183 appends a row and updates last.">
          <NumberInput value={tempText} onValueChange={setTempText} suffix="°C" />
        </Field>
      </Sheet>

      <Sheet
        open={holdOpen}
        onOpenChange={setHoldOpen}
        title="Hold the 24 ft line"
        description="Pack cannot take a held line. The rest of the trolley stays as it is."
      >
        <div className="flex flex-col gap-2">
          {HOLD_REASONS.map((reason) => (
            <Button key={reason} variant="secondary" onPress={() => hold(reason)}>
              {reason}
            </Button>
          ))}
        </div>
      </Sheet>

      <Dialog
        open={reworkOpen}
        onOpenChange={setReworkOpen}
        title="Rework"
        description="Held pieces move as rework, not scrap. The first cycle stays on AG-38."
        actions={
          <>
            <Button variant="secondary" onPress={() => setReworkOpen(false)}>
              Cancel
            </Button>
            <Button onPress={rework}>Confirm</Button>
          </>
        }
      >
        <FactGrid>
          <Fact label="Successor trolley" value="T-2" />
          <Fact label="Recipe" value={`${TOP_UP_6063_T5.alloy}-${TOP_UP_6063_T5.temper}`} />
          <Fact label="Kind" value="Top-up" />
          <Fact label="Soak" value={formatDuration(TOP_UP_6063_T5.soakMin)} />
          <Fact label="Pieces" value={`${remainingPcs(tee)} pcs`} />
          <Fact label="Set" value={`${formatTemp(TOP_UP_6063_T5.targetTempX10)}°C`} />
        </FactGrid>
      </Dialog>
    </PreviewFrame>
  );
}

function LineCard({
  line,
  recipeMin,
  footer,
}: {
  line: LiveLine;
  recipeMin: number;
  footer: ReactNode;
}) {
  const left = remainingPcs(line);
  const per = kgPer12(line);
  const band = inWeightBand(line);
  const section = SECTIONS[line.sectionId];
  const pass = line.hardnessX10.length === 0 ? null : hardnessPassed(line.hardnessX10, RECIPE_6063_T5);
  const warn = hardnessWarns(line.hardnessX10, RECIPE_6063_T5);
  const mid = median(line.hardnessX10);
  const tone: StatusTone = line.status === "held" ? "red" : line.status === "released" ? "green" : "neutral";
  const word = line.status === "held" ? "Held" : line.status === "released" ? "Released" : line.status === "closed" ? "Closed" : "Pending";
  return (
    <Card className="h-full">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="font-mono tabular-nums">{line.dieCopy}</CardTitle>
          <CardDescription>
            {section.label} · {formatCut(line.cutLengthMm)}
          </CardDescription>
        </div>
        <Chip tone={tone}>{word}</Chip>
      </div>
      <FactGrid>
        <Fact label="Loaded" value={`${line.pcs} pcs · ${formatKgFromG(line.kgG)} kg`} />
        <Fact label="Packed" value={`${line.packedPcs}`} />
        <Fact label="Remaining" value={`${left}`} />
        <Fact label="Rework" value={`${line.reworkPcs}`} />
        <Fact label="Cast" value={line.cast} />
        <Fact label="Order" value={`${line.salesOrder} · PO ${line.po}`} />
      </FactGrid>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">
        {line.customer}, {line.city}. {line.pressRun}.
      </p>
      <p className="m-0 text-[13px] leading-5 text-foreground">
        {line.hardnessX10.length === 0
          ? "Hardness not taken."
          : `Webster ${line.hardnessX10.map((n) => (n / 10).toFixed(1)).join(", ")} · ${pass ? "pass" : "fail"}`}
        {mid !== null ? ` · median ${formatTemp(mid)}` : ""}
        {warn ? " · above max, warning only" : ""}
      </p>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">
        {per === null ? "—" : `${formatKg(per, 3)} kg per 12 ft`}
        {band === null ? "" : band ? " · in band" : " · out of band"}. Minimum Webster{" "}
        {(recipeMin / 10).toFixed(1)} to pass.
      </p>
      {footer}
    </Card>
  );
}
