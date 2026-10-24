import { parseDecimal } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { Stepper } from "@orrn/ui/components/stepper";
import { cn } from "@orrn/ui/lib/utils";
import { useState } from "react";

import { Fact, FactGrid } from "./facts";
import {
  CUSTOMERS,
  DIES,
  type BandPosition,
  PLANT,
  SALES_ORDER,
  SCALE,
  OPEN_CARD,
  TROLLEY,
  bakiKg,
  bandLabel,
  bandPosition,
  dieFor,
  driftPercent,
  formatKg2,
  formatKgWhole,
  formatPercent,
  kgPer12ftAt,
  sectionLabel,
  trolleyLeft,
} from "./fixtures";

const STEPS = ["Source", "Bundles", "Review"];

type Bay = "packing" | "silent" | "empty";
type ScaleState = "stable" | "waiting";

type TypedWeight = { kg: number; reason: string };

export function PackStation() {
  const [bay, setBay] = useState<Bay>("packing");
  const [step, setStep] = useState(1);
  const [pieces, setPieces] = useState<number>(OPEN_CARD.pieces);
  const [piecesText, setPiecesText] = useState(String(OPEN_CARD.pieces));
  const [rejectPcs, setRejectPcs] = useState(0);
  const [rejectKgText, setRejectKgText] = useState("");
  const [rejectsOpen, setRejectsOpen] = useState(false);
  const [scale, setScale] = useState<ScaleState>("stable");
  const [showLogo, setShowLogo] = useState(true);
  const [typed, setTyped] = useState<TypedWeight | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [kgText, setKgText] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [kgError, setKgError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);

  const die = dieFor(TROLLEY.dieCode);
  const weightKg = shownWeight(bay, scale, typed);
  const kg12 = weightKg === null ? null : kgPer12ftAt(weightKg, pieces, TROLLEY.lengthFt);
  const band = kg12 === null ? null : bandPosition(kg12, die.bandMinKg, die.bandMaxKg);
  const drift =
    kg12 === null || die.driftKg === null ? null : driftPercent(kg12, die.driftKg);
  const running = trolleyLeft(TROLLEY.remainingPcs, pieces, rejectPcs);
  const rejectKg = parseDecimal(rejectKgText);
  const baki = bakiKg(SALES_ORDER.orderedKg, SALES_ORDER.dispatchedKg);
  const canReview = pieces > 0 && weightKg !== null && weightKg > 0 && bay !== "empty";

  const setPieceCount = (next: number) => {
    const capped = Math.max(0, Math.min(Math.floor(next), TROLLEY.remainingPcs - rejectPcs));
    if (next > TROLLEY.remainingPcs - rejectPcs) {
      setLimit("Not enough pieces left on the trolley");
    } else {
      setLimit(null);
    }
    setPieces(capped);
    setPiecesText(String(capped));
  };

  const addReject = () => {
    if (trolleyLeft(TROLLEY.remainingPcs, pieces, rejectPcs + 1) < 0) {
      setLimit("Not enough pieces left on the trolley");
      return;
    }
    setLimit(null);
    setRejectPcs((count) => count + 1);
    setRejectsOpen(true);
  };

  const openSheet = () => {
    setKgError(null);
    setReasonError(null);
    setKgText(typed ? formatKg2(typed.kg) : "");
    setReasonText(typed?.reason ?? "");
    setSheetOpen(true);
  };

  const saveTyped = () => {
    const kg = parseDecimal(kgText);
    if (kg === null) {
      setKgError("Enter the weight in kg.");
      return;
    }
    if (kg <= 0) {
      setKgError("Stable 0 is not a weight.");
      return;
    }
    if (reasonText.trim() === "") {
      setReasonError("A typed weight needs a reason.");
      setKgError(null);
      return;
    }
    setTyped({ kg, reason: reasonText.trim() });
    setSheetOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SegmentedControl
        label="Bay"
        value={bay}
        onChange={setBay}
        options={[
          { value: "packing", label: "Packing" },
          { value: "silent", label: "Scale silent" },
          { value: "empty", label: "Trolley empty" },
        ]}
      />

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-surface-sunken px-3 py-2 text-[13px]">
        <span className="font-semibold">Trolley {TROLLEY.trolley}</span>
        <span>{sectionLabel(die)}</span>
        <span className="tabular-nums">{TROLLEY.lengthFt} ft</span>
        <span>{TROLLEY.customer}</span>
        <span className="font-mono">{TROLLEY.salesOrderCode}</span>
        <span className="tabular-nums">{TROLLEY.remainingPcs} on the trolley</span>
        <span className="text-muted-foreground">Cast {TROLLEY.cast}</span>
        <span className="text-muted-foreground">Day from {PLANT.dayStart}</span>
      </div>

      <Stepper steps={STEPS} current={step} />

      {bay === "empty" ? (
        <EmptyState
          title="Trolley empty"
          body="No pieces left on this trolley. Pick another row, or pack by hand when ageing was not recorded."
        />
      ) : step === 2 ? (
        <ReviewCard
          pieces={pieces}
          weightKg={weightKg}
          kg12={kg12}
          band={band}
          showLogo={showLogo}
          typed={typed}
          rejectPcs={rejectPcs}
          rejectKg={rejectKg}
          onBack={() => setStep(1)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Bundle</CardTitle>
          </CardHeader>
          <CardContent className="gap-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <span className="text-[13px] font-medium text-muted-foreground">Pieces</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    aria-label="Fewer pieces"
                    onPress={() => setPieceCount(pieces - 1)}
                  >
                    −
                  </Button>
                  <NumberInput
                    aria-label="Pieces"
                    value={piecesText}
                    decimal={false}
                    onValueChange={(text) => {
                      setPiecesText(text);
                      const parsed = parseDecimal(text);
                      setPieceCount(parsed === null ? 0 : parsed);
                    }}
                  />
                  <Button
                    variant="secondary"
                    aria-label="More pieces"
                    onPress={() => setPieceCount(pieces + 1)}
                  >
                    +
                  </Button>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-muted-foreground">Weight</span>
                  <WeightChip bay={bay} scale={scale} typed={typed} />
                </div>
                <p className="m-0 font-mono text-[28px] font-semibold tabular-nums leading-none">
                  {weightKg === null ? "—" : `${formatKg2(weightKg)} kg`}
                </p>
                {bay === "packing" ? (
                  <SegmentedControl
                    label="Scale"
                    value={scale}
                    onChange={setScale}
                    options={[
                      { value: "stable", label: "Stable" },
                      { value: "waiting", label: "Waiting" },
                    ]}
                  />
                ) : (
                  <p className="m-0 text-[13px] text-muted-foreground">
                    No frames from {SCALE.nodeId}. Type the weight to continue.
                  </p>
                )}
                {typed ? (
                  <p className="m-0 text-[13px] text-muted-foreground">Reason: {typed.reason}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onPress={openSheet}>
                    Type the weight
                  </Button>
                  {typed ? (
                    <Button variant="ghost" onPress={() => setTyped(null)}>
                      Use the scale
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="m-0 text-[15px]">
                  kg/12 ft{" "}
                  <span className="font-mono font-semibold tabular-nums">
                    {kg12 === null ? "—" : formatKg2(kg12)}
                  </span>
                </p>
                {band ? (
                  <Chip tone={band === "in" ? "green" : "amber"}>{bandLabel(band)}</Chip>
                ) : null}
              </div>
              {kg12 !== null && die.driftKg !== null ? (
                <p className="m-0 text-[13px] text-muted-foreground">
                  Drift on {die.copyCode} is {formatKg2(die.driftKg)}, this bundle {formatKg2(kg12)}.
                  {drift !== null ? (
                    <>
                      {" "}
                      {formatPercent(Math.abs(drift))}% {drift < 0 ? "under" : "over"} the drift reading.
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="m-0 text-[13px] text-muted-foreground">
                  Enter pieces and a weight to see kg/12 ft against the {sectionLabel(die)} band (
                  {formatKg2(die.bandMinKg)}–{formatKg2(die.bandMaxKg)}).
                </p>
              )}
              {kg12 !== null ? <BandMark kg12={kg12} min={die.bandMinKg} max={die.bandMaxKg} /> : null}
              <p className="m-0 text-[13px] text-muted-foreground" aria-live="polite">
                After this bundle: {running} left on the trolley · {TROLLEY.remainingPcs} − {pieces} good − {rejectPcs} reject
              </p>
              {limit ? (
                <p className="m-0 text-[13px] font-medium text-destructive" role="status">
                  {limit}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-3 rounded-full pr-2 text-left text-[15px] font-semibold"
                onClick={() => setRejectsOpen((open) => !open)}
                aria-expanded={rejectsOpen}
              >
                <span>Rejects</span>
                <span className="font-mono tabular-nums text-muted-foreground">{rejectPcs} pcs</span>
              </button>
              <Button variant="secondary" onPress={addReject}>
                Add reject
              </Button>
            </div>
            {rejectsOpen ? (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-[13px] text-muted-foreground">
                  Reject pieces leave the trolley. They are not a bundle. Kg, if you enter it, posts at
                  plant scrap.
                </p>
                <Field label="Reject kg" hint="Leave blank if the pieces were not weighed.">
                  <NumberInput
                    value={rejectKgText}
                    onValueChange={setRejectKgText}
                    suffix="kg"
                    aria-label="Reject kg"
                  />
                </Field>
                {rejectPcs > 0 ? (
                  <p className="m-0 text-[13px] text-muted-foreground">
                    {rejectKg !== null && rejectKg > 0
                      ? `${formatKg2(rejectKg)} kg posts at plant scrap.`
                      : "No weight, so no kg row. The pieces still count as left the trolley."}
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              role="switch"
              aria-checked={showLogo}
              onClick={() => setShowLogo((on) => !on)}
              className="inline-flex min-h-11 items-center gap-3 self-start rounded-full text-left text-[15px] font-semibold"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-[var(--dur-fast)]",
                  showLogo ? "bg-foreground" : "bg-control/45",
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 left-1 size-5 rounded-full bg-background transition-transform duration-[var(--dur-fast)]",
                    showLogo ? "translate-x-5" : "translate-x-0",
                  )}
                />
              </span>
              Logo on the label
            </button>

            <p className="m-0 text-[13px] text-muted-foreground">
              {sectionLabel(die)} · band {formatKg2(die.bandMinKg)}–{formatKg2(die.bandMaxKg)} kg/12 ft ·{" "}
              {die.standard} {die.cml} · next party number {CUSTOMERS.bhavesh.nextPartyNo}
            </p>
          </CardContent>
        </Card>
      )}

      {bay !== "empty" && step < 2 ? (
        <div className="sticky bottom-[var(--shell-tabbar-offset)] z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card/95 p-3 shadow-md backdrop-blur-md">
          <p className="m-0 min-w-0 text-[15px] font-semibold tabular-nums">
            1 bundle · {pieces} pcs · {weightKg === null ? "0 kg" : `${formatKg2(weightKg)} kg`}
          </p>
          <Button size="lg" disabled={!canReview} onPress={() => setStep(2)}>
            Review
          </Button>
        </div>
      ) : null}

      <p className="m-0 text-[13px] text-muted-foreground">
        Baki on {SALES_ORDER.code} is {formatKgWhole(baki)} kg ({formatKgWhole(SALES_ORDER.orderedKg)} ordered −{" "}
        {formatKgWhole(SALES_ORDER.dispatchedKg)} dispatched). Packing does not change baki.
      </p>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Type the weight"
        description="The scale reading stays on the card until you save. A typed weight needs a reason."
        footer={
          <>
            <Button variant="secondary" onPress={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button onPress={saveTyped}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Weight" error={kgError ?? undefined} hint="Kilograms on the bundle, not the rejects.">
            <NumberInput value={kgText} onValueChange={setKgText} suffix="kg" aria-label="Weight in kg" />
          </Field>
          <Field label="Reason" id="typed-weight-reason" error={reasonError ?? undefined}>
            <TextArea
              id="typed-weight-reason"
              value={reasonText}
              onChangeText={setReasonText}
              rows={3}
              aria-invalid={reasonError ? true : undefined}
              placeholder="Scale jumped, or the indicator was silent"
            />
          </Field>
          <TypedPreview kgText={kgText} pieces={pieces} />
        </div>
      </Sheet>
    </div>
  );
}

function shownWeight(bay: Bay, scale: ScaleState, typed: TypedWeight | null): number | null {
  if (typed) return typed.kg;
  if (bay === "silent" || scale === "waiting") return null;
  return SCALE.kg;
}

function WeightChip({
  bay,
  scale,
  typed,
}: {
  bay: Bay;
  scale: ScaleState;
  typed: TypedWeight | null;
}) {
  if (typed) return <Chip tone="amber">Typed</Chip>;
  if (bay === "silent") return <Chip tone="amber">Scale silent</Chip>;
  if (scale === "waiting") return <Chip tone="amber">Waiting</Chip>;
  return <Chip tone="green">From the scale</Chip>;
}

function BandMark({ kg12, min, max }: { kg12: number; min: number; max: number }) {
  const span = max - min;
  const ratio = span <= 0 ? 0 : Math.min(1, Math.max(0, (kg12 - min) / span));
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-1.5 rounded-full bg-surface-sunken">
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `calc(${ratio * 100}% - 5px)` }}
        />
      </div>
      <div className="flex justify-between text-[12px] text-muted-foreground tabular-nums">
        <span>{formatKg2(min)}</span>
        <span>{formatKg2(max)}</span>
      </div>
    </div>
  );
}

function TypedPreview({ kgText, pieces }: { kgText: string; pieces: number }) {
  const kg = parseDecimal(kgText);
  if (kg === null || kg <= 0 || pieces <= 0) return null;
  const kg12 = kgPer12ftAt(kg, pieces, TROLLEY.lengthFt);
  if (kg12 === null) return null;
  const die = DIES.d12170;
  const band = bandPosition(kg12, die.bandMinKg, die.bandMaxKg);
  return (
    <p className="m-0 text-[13px] text-muted-foreground">
      That weight is {formatKg2(kg12)} kg/12 ft, {bandLabel(band).toLowerCase()}.
    </p>
  );
}

function ReviewCard({
  pieces,
  weightKg,
  kg12,
  band,
  showLogo,
  typed,
  rejectPcs,
  rejectKg,
  onBack,
}: {
  pieces: number;
  weightKg: number | null;
  kg12: number | null;
  band: BandPosition | null;
  showLogo: boolean;
  typed: TypedWeight | null;
  rejectPcs: number;
  rejectKg: number | null;
  onBack: () => void;
}) {
  const die = DIES.d12170;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Label</CardTitle>
        </CardHeader>
        <CardContent className="gap-4">
          {showLogo ? (
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-card bg-foreground font-display text-[15px] font-bold text-background">
                FC
              </span>
              <p className="m-0 text-[13px] text-muted-foreground">Extrusions · Surat</p>
            </div>
          ) : null}
          <p className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">{PLANT.name}, {PLANT.city}</p>
          <p className="m-0 font-mono text-[32px] font-semibold tabular-nums leading-none">
            {CUSTOMERS.bhavesh.nextPartyNo}
          </p>
          <p className="m-0 text-[13px] text-muted-foreground">
            Party number, monthly. The QR is the scan serial only — it does not carry the kg.
          </p>
          <FactGrid>
            <Fact label="Section" value={sectionLabel(die)} mono />
            <Fact label="Cut" value={`${TROLLEY.lengthFt} ft`} />
            <Fact label="Pieces" value={pieces} />
            <Fact label="Weight" value={weightKg === null ? "—" : `${formatKg2(weightKg)} kg`} mono />
            <Fact label="kg/12 ft" value={kg12 === null ? "—" : formatKg2(kg12)} mono />
            <Fact label="Cast" value={TROLLEY.cast} mono />
            <Fact label="Sales order" value={SALES_ORDER.code} mono />
            <Fact label="Standard" value={`${die.standard} · ${die.cml}`} />
            <Fact label="Die copy" value={die.copyCode ?? "—"} mono />
          </FactGrid>
          {band ? <Chip tone={band === "in" ? "green" : "amber"}>{bandLabel(band)}</Chip> : null}
          <p className="m-0 text-[13px] text-muted-foreground">
            {typed ? `Typed · ${typed.reason}` : "From the scale"}
            {showLogo ? " · logo on" : " · logo off"}
          </p>
        </CardContent>
      </Card>

      {rejectPcs > 0 ? (
        <Card>
          <CardContent>
            <p className="m-0 text-[15px] font-semibold">
              {rejectPcs} reject pcs
              {rejectKg !== null && rejectKg > 0 ? ` · ${formatKg2(rejectKg)} kg at plant scrap` : " · no kg row"}
            </p>
            <p className="m-0 text-[13px] text-muted-foreground">
              These pieces left the trolley. They are not on the label.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onPress={onBack}>
          Back to bundles
        </Button>
      </div>
    </div>
  );
}
