import { parseDecimal } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { ListCard, stretchedLink } from "@orrn/ui/components/list-card";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

import { Fact, FactGrid } from "./bits";
import {
  AG40_IN_AT,
  AG40_LINES,
  AG40_TEMPS,
  AVAILABLE_LINES,
  BOARD_FEATURES,
  DEMO_CLOCK,
  NEXT_BATCH_NUMBER,
  OVENS,
  RECIPE_6063_T5,
  SECTIONS,
  SHIFTS,
  TROLLEYS,
  capacityWarning,
  formatCapacityKg,
  formatClock,
  formatCut,
  formatDuration,
  formatKgFromG,
  formatShiftSpan,
  formatTemp,
  lastTemp,
  prorateG,
  soakMinutes,
  sumG,
  sumPcs,
  type AvailableLine,
  type BoardChip,
  type ShiftId,
} from "./fixtures";
import { ageingBatchTo, ageingReportTo } from "./paths";

const mod = previewModule("ageing")!;

const CHIPS: { id: BoardChip; label: string }[] = [
  { id: "in_oven", label: "In oven" },
  { id: "out", label: "Out" },
  { id: "released", label: "Released" },
  { id: "held", label: "Held" },
];

type DraftLine = {
  id: string;
  checked: boolean;
  pcsText: string;
};

type LoadedLine = {
  pressRun: string;
  dieCopy: string;
  pcs: number;
  kgG: number;
  salesOrder: string;
  customer: string;
};

type LoadedCard = {
  number: string;
  trolley: string;
  pcs: number;
  kgG: number;
  lines: LoadedLine[];
};

function draftError(text: string, left: number): string | undefined {
  const n = parseDecimal(text);
  if (n === null || !Number.isInteger(n)) return "Enter whole pieces.";
  if (n < 1) return "Enter at least 1 piece.";
  if (n > left) return `Only ${left} pcs left.`;
  return undefined;
}

function trolleyBlock(code: string, loaded: readonly LoadedCard[]): string | null {
  if (code === "T-1") return "T-1 is on AG-38 until that batch closes.";
  if (code === "T-3") return "T-3 is in the oven on AG-40.";
  if (loaded.some((card) => card.trolley === code)) return `${code} already has an open batch.`;
  return null;
}

export function AgeingBoard() {
  const day = SHIFTS[0]!;
  const [shift, setShift] = useState<ShiftId>("day");
  const [chip, setChip] = useState<BoardChip | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [trolley, setTrolley] = useState("T-2");
  const [trolleyError, setTrolleyError] = useState<string | undefined>();
  const [left, setLeft] = useState<Record<string, number>>(() =>
    Object.fromEntries(AVAILABLE_LINES.map((line) => [line.id, line.pcsLeft])),
  );
  const [drafts, setDrafts] = useState<DraftLine[]>(() =>
    AVAILABLE_LINES.map((line) => ({ id: line.id, checked: true, pcsText: String(line.pcsLeft) })),
  );
  const [loaded, setLoaded] = useState<LoadedCard[]>([]);

  const oven = OVENS[0]!;
  const emptyOven = OVENS[1]!;
  const ag40Pcs = sumPcs(AG40_LINES);
  const ag40G = sumG(AG40_LINES);
  const soak = soakMinutes(AG40_TEMPS, RECIPE_6063_T5, DEMO_CLOCK);
  const last = lastTemp(AG40_TEMPS);
  const over = capacityWarning(ag40G, oven.capacityG);
  const show = (id: BoardChip) => chip === null || chip === id;
  const waiting = AVAILABLE_LINES.filter((line) => (left[line.id] ?? 0) > 0);

  const openLoad = () => {
    setTrolleyError(undefined);
    setLoadOpen(true);
  };

  const submitLoad = () => {
    const block = trolleyBlock(trolley, loaded);
    const picked = drafts.filter((draft) => draft.checked);
    const invalid = picked.some((draft) => {
      const line = AVAILABLE_LINES.find((row) => row.id === draft.id);
      return !line || draftError(draft.pcsText, left[line.id] ?? 0) !== undefined;
    });
    if (block) {
      setTrolleyError(block);
      return;
    }
    if (picked.length === 0) {
      setTrolleyError("Pick a line from the press.");
      return;
    }
    if (invalid) {
      setTrolleyError(undefined);
      return;
    }
    setTrolleyError(undefined);
    const lines: LoadedLine[] = [];
    const nextLeft = { ...left };
    for (const draft of picked) {
      const line = AVAILABLE_LINES.find((row) => row.id === draft.id);
      if (!line) continue;
      const pcs = parseDecimal(draft.pcsText);
      if (pcs === null) continue;
      const kgG = prorateG(line.kgG, line.pcsLeft, pcs);
      lines.push({
        pressRun: line.pressRun,
        dieCopy: line.dieCopy,
        pcs,
        kgG,
        salesOrder: line.salesOrder,
        customer: line.customer,
      });
      nextLeft[line.id] = (nextLeft[line.id] ?? 0) - pcs;
    }
    const card: LoadedCard = {
      number: NEXT_BATCH_NUMBER,
      trolley,
      pcs: lines.reduce((sum, line) => sum + line.pcs, 0),
      kgG: lines.reduce((sum, line) => sum + line.kgG, 0),
      lines,
    };
    setLeft(nextLeft);
    setLoaded((prev) => [...prev, card]);
    setDrafts((prev) =>
      prev.map((draft) => {
        const remain = nextLeft[draft.id] ?? 0;
        return { ...draft, checked: remain > 0 && draft.checked, pcsText: remain > 0 ? String(remain) : "0" };
      }),
    );
    setChip(null);
    setShift("day");
    setLoadOpen(false);
  };

  return (
    <PreviewFrame
      title="Ageing"
      summary="Ovens, trolleys, and what is safe to pack."
      featureIds={[...BOARD_FEATURES]}
      specPath={mod.specPath}
      actions={
        <>
          <Button variant="secondary" asChild>
            <Link to={ageingBatchTo}>AG-38</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to={ageingReportTo}>Ageing report</Link>
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-5">
        <Toolbar
          actions={
            <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
              Clock {formatClock(DEMO_CLOCK)}
            </p>
          }
        >
          <SegmentedControl
            label="Shift"
            value={shift}
            onChange={setShift}
            options={SHIFTS.map((row) => ({ value: row.id, label: row.name }))}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Board">
            {CHIPS.map((item) => {
              const on = chip === item.id;
              return (
                <Button
                  key={item.id}
                  variant={on ? "secondary" : "ghost"}
                  aria-pressed={on}
                  onPress={() => setChip(on ? null : item.id)}
                >
                  {item.label}
                </Button>
              );
            })}
          </div>
        </Toolbar>
        <p className="m-0 text-[13px] text-muted-foreground">
          {day.name} shift, {formatShiftSpan(day)}.
        </p>

        {shift === "night" ? (
          <EmptyState title="Nothing on the night shift." body="Day shift has the ovens and the trolleys." />
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-3" aria-label="Ovens">
              <h2 className="m-0 text-[13px] font-semibold text-muted-foreground">Ovens</h2>
              {show("in_oven") ? (
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="font-mono tabular-nums">{oven.code}</CardTitle>
                    <Chip tone="amber">In oven</Chip>
                  </div>
                  <StatusBlock
                    tone="amber"
                    title="AG-40"
                    meta={`T-3 · 6063-T5 · set ${formatTemp(RECIPE_6063_T5.targetTempX10)}°C`}
                    value={last ? last.tempX10 / 10 : 0}
                    format={(n) => n.toFixed(1)}
                    unit="°C last"
                    progress={soak === null ? undefined : soak / RECIPE_6063_T5.soakMin}
                    countUp={false}
                    onClick={() => setNote("Still in the oven.")}
                  />
                  <FactGrid>
                    <Fact label="Soak" value={`${formatDuration(soak ?? 0)} of ${formatDuration(RECIPE_6063_T5.soakMin)}`} />
                    <Fact label="In" value={formatClock(AG40_IN_AT)} />
                    <Fact label="Pieces" value={`${ag40Pcs} pcs`} />
                    <Fact label="Theoretical" value={`${formatKgFromG(ag40G)} kg`} />
                  </FactGrid>
                  <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                    Capacity {formatCapacityKg(oven.capacityG)} kg. {over ?? "Within capacity."}
                  </p>
                  {note ? (
                    <p role="status" className="m-0 text-[14px] font-medium text-foreground">
                      {note}
                    </p>
                  ) : null}
                </Card>
              ) : (
                <p className="m-0 text-[13px] text-muted-foreground">No oven in that state.</p>
              )}
              {chip === null ? (
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="font-mono tabular-nums">{emptyOven.code}</CardTitle>
                    <Chip tone="neutral">Active</Chip>
                  </div>
                  <EmptyState
                    className="px-2 py-6"
                    title="Empty"
                    body={`Capacity ${formatCapacityKg(emptyOven.capacityG)} kg. Status active.`}
                  />
                </Card>
              ) : null}
            </section>

            <section className="flex min-w-0 flex-col gap-3" aria-label="Trolleys">
              <h2 className="m-0 text-[13px] font-semibold text-muted-foreground">Trolleys</h2>
              {chip === "in_oven" ? (
                <p className="m-0 text-[13px] text-muted-foreground">No trolley in that state. T-3 is on the oven card.</p>
              ) : (
                <TrolleyOut />
              )}
              {chip === null ? <TrolleyFree /> : null}
              {loaded.map((card) => (
                <Card key={card.number}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="font-mono tabular-nums">{card.trolley}</CardTitle>
                    <Chip tone="blue">Loading</Chip>
                  </div>
                  <p className="m-0 font-mono text-[15px] font-semibold tabular-nums">
                    {card.number} · {card.pcs} pcs · {formatKgFromG(card.kgG)} kg theoretical
                  </p>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-muted-foreground">
                    {card.lines.map((line) => (
                      <li key={line.pressRun} className="font-mono tabular-nums">
                        {line.pressRun} · {line.dieCopy} · {line.pcs} pcs · {line.salesOrder} {line.customer}
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-[13px] text-muted-foreground">Not started. Nothing was saved.</p>
                </Card>
              ))}
            </section>
          </div>
        )}

        <FormActions className="sticky bottom-3 z-10 rounded-card border border-border bg-card/95 p-2 shadow-md backdrop-blur-md">
          <Button size="lg" onPress={openLoad}>
            Load trolley
          </Button>
        </FormActions>
      </div>

      <Sheet
        open={loadOpen}
        onOpenChange={setLoadOpen}
        title="Load trolley"
        description="Logged press lines. Kilograms are prorated, not typed."
        footer={
          <>
            <Button variant="secondary" onPress={() => setLoadOpen(false)}>
              Cancel
            </Button>
            <Button onPress={submitLoad}>Load</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Trolley" error={trolleyError} hint="Painted number. Defaults to the free rack.">
            <NativeSelect aria-label="Trolley" value={trolley} onChange={(e) => setTrolley(e.target.value)}>
              {TROLLEYS.map((row) => (
                <option key={row.id} value={row.code}>
                  {row.code}
                  {trolleyBlock(row.code, loaded) ? " · in use" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {waiting.length === 0 ? (
            <EmptyState title="Nothing is waiting from the press." body="Logged lines with pieces left will show here." />
          ) : (
            waiting.map((line) => (
              <LoadLine
                key={line.id}
                line={line}
                remain={left[line.id] ?? 0}
                draft={drafts.find((row) => row.id === line.id)}
                onChecked={(checked) =>
                  setDrafts((prev) => prev.map((row) => (row.id === line.id ? { ...row, checked } : row)))
                }
                onPcs={(pcsText) =>
                  setDrafts((prev) => prev.map((row) => (row.id === line.id ? { ...row, pcsText } : row)))
                }
              />
            ))
          )}
          <LoadSum drafts={drafts} left={left} />
        </div>
      </Sheet>
    </PreviewFrame>
  );
}

function TrolleyOut() {
  return (
    <>
      <div className="md:hidden">
        <ListCard
          mono
          title={
            <Link to={ageingBatchTo} className={stretchedLink}>
              T-1
            </Link>
          }
          titleText="T-1"
          subtitle="AG-38 · Royal Aluminium"
          status={
            <span className="flex flex-wrap justify-end gap-1">
              <Chip tone="green">Released</Chip>
              <Chip tone="red">Held</Chip>
            </span>
          }
          facts={[
            { label: "Packable", value: "63 pcs", mono: true },
            { label: "Held", value: "36 pcs", mono: true },
            { label: "Out of", value: "OV-1", mono: true },
          ]}
        />
      </div>
      <Card className="hidden md:flex">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="font-mono tabular-nums">
              <Link to={ageingBatchTo} className="text-foreground no-underline">
                T-1
              </Link>
            </CardTitle>
            <p className="m-0 text-[13px] text-muted-foreground">AG-38 · out · Royal Aluminium</p>
          </div>
          <span className="flex flex-wrap gap-1">
            <Chip tone="green">Released</Chip>
            <Chip tone="red">Held</Chip>
          </span>
        </div>
        <FactGrid>
          <Fact label="Packable" value="63 pcs" />
          <Fact label="Held" value="36 pcs" />
          <Fact label="Oven" value="OV-1" />
          <Fact label="Shift" value="Day" />
        </FactGrid>
      </Card>
    </>
  );
}

function TrolleyFree() {
  return (
    <>
      <div className="md:hidden">
        <ListCard
          mono
          title="T-2"
          titleText="T-2"
          subtitle="No batch"
          status={<Chip tone="neutral">Available</Chip>}
          facts={[
            { label: "Batch", value: "None" },
            { label: "Status", value: "Free" },
            { label: "Rack", value: "T-2", mono: true },
          ]}
          footer="The painted number can take a new load."
          className="bg-surface-sunken"
        />
      </div>
      <Card className="hidden bg-surface-sunken md:flex">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-mono tabular-nums text-muted-foreground">T-2</CardTitle>
          <Chip tone="neutral">Available</Chip>
        </div>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">No batch. The painted number can take a new load.</p>
      </Card>
    </>
  );
}

function LoadLine({
  line,
  remain,
  draft,
  onChecked,
  onPcs,
}: {
  line: AvailableLine;
  remain: number;
  draft: DraftLine | undefined;
  onChecked: (checked: boolean) => void;
  onPcs: (text: string) => void;
}) {
  const checked = draft?.checked ?? false;
  const pcsText = draft?.pcsText ?? String(remain);
  const error = checked ? draftError(pcsText, remain) : undefined;
  const pcs = parseDecimal(pcsText);
  const kgG = pcs !== null && Number.isInteger(pcs) && pcs > 0 && pcs <= remain ? prorateG(line.kgG, line.pcsLeft, pcs) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border p-3">
      <label className="flex min-w-0 items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          onCheckedChange={(value) => onChecked(value === true)}
          aria-label={`Load ${line.pressRun}`}
        />
        <span className="min-w-0">
          <span className="block font-mono text-[15px] font-semibold tabular-nums">
            {line.pressRun} · {line.dieCopy}
          </span>
          <span className="block text-[13px] leading-5 text-muted-foreground">
            {formatCut(line.cutLengthMm)} · {remain} pcs left · cast {line.cast}
          </span>
          <span className="block text-[13px] leading-5 text-muted-foreground">
            {line.salesOrder} · {line.customer}, {line.city} · PO {line.po}
          </span>
          <span className="block text-[13px] leading-5 text-muted-foreground">{SECTIONS[line.sectionId].label}</span>
        </span>
      </label>
      <Field label="Pieces" error={error} hint={checked ? `${formatKgFromG(kgG)} kg theoretical` : "Unchecked"}>
        <NumberInput value={pcsText} onValueChange={onPcs} decimal={false} suffix="pcs" disabled={!checked} />
      </Field>
    </div>
  );
}

function LoadSum({ drafts, left }: { drafts: readonly DraftLine[]; left: Record<string, number> }) {
  let pcs = 0;
  let kgG = 0;
  for (const draft of drafts) {
    if (!draft.checked) continue;
    const line = AVAILABLE_LINES.find((row) => row.id === draft.id);
    if (!line) continue;
    const n = parseDecimal(draft.pcsText);
    const remain = left[line.id] ?? 0;
    if (n === null || !Number.isInteger(n) || n < 1 || n > remain) continue;
    pcs += n;
    kgG += prorateG(line.kgG, line.pcsLeft, n);
  }
  return (
    <p className="m-0 font-mono text-[14px] tabular-nums text-foreground">
      {pcs} pcs · {formatKgFromG(kgG)} kg theoretical
    </p>
  );
}
