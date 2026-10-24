import { formatKg, formatKgTotal, gToKg, kgToG } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { Card } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { TextArea } from "@orrn/ui/components/input";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { Stepper } from "@orrn/ui/components/stepper";
import { useEffect, useState } from "react";

import {
  CASTS,
  COUNT_STEPS,
  DOWNTIME_REASONS,
  ISSUE,
  LINE,
  ORDERS,
  PEOPLE,
  PR43,
  PREVIEW_START,
  PREVIEW_STOP,
  QC_REASONS,
  SECTION,
  SHIFTS,
  WINDOW_MIN,
  bakiKg,
  castByCode,
  driftPercent,
  evaluateLog,
  feetToMm,
  formatBand,
  formatClock,
  formatKgG,
  formatMinutes,
  formatRecoveryBp,
  inBand,
  type LogEvaluation,
  lightestInBandCopy,
  lengthLabel,
  orderByNumber,
  parseNonNegInt,
  parseNonNegKgG,
  parseOptionalKg,
  pressedSentence,
  reasonLabel,
  theoreticalGoodG,
  type ClockPhase,
} from "../fixtures";
import {
  addBillet,
  decideReopen,
  handover,
  logRun,
  removeBillet,
  requestReopen,
  setBilletShortReason,
  setButt,
  setCast,
  setDieRemark,
  setDrift,
  setEnds,
  setPostedInput,
  setPr43Shift,
  setPressRemark,
  setPressedLength,
  setReject,
  setRejectNote,
  setRejectReason,
  setStep,
  showCounting,
  startDowntime,
  stopDowntime,
  stopPreview,
  updateBillet,
  updateCut,
  usePressDemo,
} from "../store";
import { DrawingDialog, Fact, ScreenLinks } from "./chrome";

const BILLET_LENGTHS = [18, 20, 22, 24].map((feet) => ({
  value: String(feetToMm(feet)),
  label: `${feet} ft`,
}));

export function PressStation({ runId }: { runId: "PR-43" | "PR-42" }) {
  return (
    <div className="flex min-w-0 flex-col gap-5 text-[17px] leading-7">
      <ScreenLinks current="station" />
      {runId === "PR-43" ? <LockedRun /> : <ActiveRun />}
    </div>
  );
}

function LockedRun() {
  const demo = usePressDemo();
  const [drawing, setDrawing] = useState(false);
  const hint = lightestInBandCopy();
  const shift = SHIFTS.find((item) => item.id === demo.pr43Shift) ?? SHIFTS[0];

  return (
    <>
      <div role="status" className="rounded-card border border-border bg-surface-sunken px-4 py-3">
        <p className="m-0 text-[18px] font-semibold leading-6">Die not issued. Start is locked.</p>
        <p className="m-0 mt-1 text-[15px] leading-6 text-muted-foreground">
          The die room issues the copy. The press cannot. There is no start button on this run.
        </p>
      </div>
      <Card className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[13px] text-muted-foreground">{LINE.name}</p>
            <h2 className="m-0 font-mono text-[32px] font-semibold leading-none tabular-nums">PR-43</h2>
            <p className="m-0 mt-2 text-[18px] font-semibold">{SECTION.label}</p>
            <p className="m-0 text-[15px] text-muted-foreground">Band {formatBand()}</p>
          </div>
          <Chip tone="amber">Queued</Chip>
        </div>
        <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact
            label="Orders"
            value={PR43.cuts
              .map((cut) => {
                const order = orderByNumber(cut.salesOrder);
                return `${cut.salesOrder} ${order?.customer}, ${order?.city}`;
              })
              .join(" · ")}
          />
          <Fact
            label="Released"
            value={PR43.cuts
              .map((cut) => {
                const order = orderByNumber(cut.salesOrder);
                const kgG = theoreticalGoodG(cut.pcs, cut.cutLengthMm, SECTION.latestMilli);
                const kg = kgG === null ? "—" : `${formatKg(gToKg(kgG))} kg`;
                return `${order?.short ?? cut.salesOrder} ${lengthLabel(cut.cutLengthMm)} × ${cut.pcs} pcs · ${kg}`;
              })
              .join(" · ")}
          />
        </dl>
        <p className="m-0 text-[15px] leading-6">
          Lightest in-band copy:{" "}
          <span className="font-mono tabular-nums">
            {hint ? `${hint.code} · ${formatKg(hint.kgPer12ft, 3)} kg per 12 ft` : "none"}
          </span>
          . Hint only. 12170-1 is issued to PR-42.
        </p>
        <Button variant="secondary" onClick={() => setDrawing(true)}>
          Section drawing
        </Button>
      </Card>
      <Card className="gap-3">
        <SegmentedControl
          label="Shift, before start"
          value={demo.pr43Shift}
          onChange={setPr43Shift}
          options={SHIFTS.map((item) => ({ value: item.id, label: item.name }))}
        />
        <p className="m-0 text-[14px] text-muted-foreground">
          {shift.name} {shift.start}–{shift.end}. Shift can change before start only. Start stays locked.
        </p>
      </Card>
      <DrawingDialog open={drawing} onOpenChange={setDrawing} />
    </>
  );
}

function ActiveRun() {
  const demo = usePressDemo();
  const run = demo.pr42;
  const [drawing, setDrawing] = useState(false);
  const evaluation = evaluateLog(run, demo.viewer);

  return (
    <>
      <Card className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[13px] text-muted-foreground">
              {LINE.name} · {ISSUE.copy} issued {ISSUE.at}
            </p>
            <h2 className="m-0 font-mono text-[32px] font-semibold leading-none tabular-nums">PR-42</h2>
            <p className="m-0 mt-2 text-[18px] font-semibold">{SECTION.label}</p>
            <p className="m-0 text-[15px] text-muted-foreground">
              Band {formatBand()} · latest {formatKg(SECTION.latestKg, 3)} kg per 12 ft
            </p>
          </div>
          <Chip tone={phaseTone(run.phase)}>{phaseWord(run.phase)}</Chip>
        </div>
        <p className="m-0 text-[15px]">
          {PEOPLE.operator} started at {PREVIEW_START}
          {run.phase === "stopped" || run.phase === "counting" || run.phase === "logged"
            ? ` and stopped at ${PREVIEW_STOP}`
            : ""}
          {run.relief ? ` · ${run.relief} took over` : ""}. Day 08:00–20:00. Issued by the {ISSUE.by.toLowerCase()}.
        </p>
        {run.relief ? (
          <p className="m-0 text-[14px] text-muted-foreground">
            Handover does not restart the run. Started stays {PREVIEW_START}.
          </p>
        ) : null}
        <Button variant="secondary" onClick={() => setDrawing(true)}>
          Section drawing
        </Button>
      </Card>

      {run.phase === "running" ? <RunningPanel since={run.runningSinceWall} /> : null}
      {run.phase === "stopped" ? <StoppedPanel /> : null}
      {run.phase === "counting" ? <CountingPanel evaluation={evaluation} viewer={demo.viewer} /> : null}
      {run.phase === "logged" && run.logged ? <LoggedPanel /> : null}
      {run.reopen === "approved" && run.phase === "counting" ? (
        <p role="status" className="m-0 text-[15px] leading-6">
          Reopen approved. Recovery cleared. Ageing has not loaded these lines.
        </p>
      ) : null}
      <DrawingDialog open={drawing} onOpenChange={setDrawing} />
    </>
  );
}

function RunningPanel({ since }: { since: number | null }) {
  const demo = usePressDemo();
  const [now, setNow] = useState(() => Date.now());
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [reason, setReason] = useState("billet_wait");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openedAt, setOpenedAt] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
  const openRow = demo.pr42.downtime.find((row) => row.open);

  return (
    <>
      <Card className="gap-2">
        <p className="m-0 text-[13px] font-medium text-muted-foreground">Started {PREVIEW_START}</p>
        <p className="m-0 font-mono text-[44px] font-semibold leading-none tabular-nums" aria-live="polite">
          {formatClock(elapsed)}
        </p>
        <p className="m-0 text-[14px] text-muted-foreground">Stop will record {PREVIEW_STOP}.</p>
      </Card>
      <DowntimeList />
      <FormActions className="md:sticky md:bottom-4 md:z-10 md:rounded-card md:border md:border-border md:bg-card/95 md:p-2 md:shadow-sm md:backdrop-blur-md">
        <Button variant="secondary" onClick={() => setHandoverOpen(true)}>
          Handover
        </Button>
        {openRow ? (
          <Button
            variant="secondary"
            onClick={() => {
              const minutes = openedAt === null ? 1 : Math.max(1, Math.round((Date.now() - openedAt) / 60000));
              const message = stopDowntime(minutes);
              setError(message);
              if (!message) setOpenedAt(null);
            }}
          >
            Stop downtime
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setDowntimeOpen(true)}>
            Start downtime
          </Button>
        )}
        <Button onClick={stopPreview}>Stop</Button>
      </FormActions>
      {error ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Sheet
        open={downtimeOpen}
        onOpenChange={setDowntimeOpen}
        title="Start a stoppage"
        description="One open row. Other needs a note. Minutes are tracked automatically."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDowntimeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const message = startDowntime(reason, note);
                setError(message);
                if (!message) {
                  setOpenedAt(Date.now());
                  setDowntimeOpen(false);
                  setNote("");
                }
              }}
            >
              Start downtime
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Reason">
            <Select
              aria-label="Downtime reason"
              value={reason}
              onValueChange={setReason}
              options={DOWNTIME_REASONS.map((item) => ({ value: item.code, label: `${item.code} · ${item.label}` }))}
            />
          </Field>
          <Field label="Note" hint={reason === "other" ? "Required for other." : "Optional, unless the reason is other."}>
            <TextArea value={note} onChangeText={setNote} rows={3} />
          </Field>
          {error ? <p className="m-0 text-[14px] font-medium text-destructive">{error}</p> : null}
        </div>
      </Sheet>
      <Dialog
        open={handoverOpen}
        onOpenChange={setHandoverOpen}
        title="Handover"
        description="The press man changes. The run does not restart."
        actions={
          <>
            <Button variant="secondary" onClick={() => setHandoverOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                handover(PEOPLE.relief);
                setHandoverOpen(false);
              }}
            >
              {PEOPLE.relief} takes over
            </Button>
          </>
        }
      >
        <p className="m-0 text-[15px] leading-6">
          {PEOPLE.operator} stays the operator who started. {PEOPLE.relief} is relief. Started stays {PREVIEW_START}.
        </p>
      </Dialog>
    </>
  );
}

function StoppedPanel() {
  const demo = usePressDemo();
  const downtimeMin = demo.pr42.downtime.reduce((sum, row) => sum + (row.open ? 0 : row.minutes), 0);
  return (
    <>
      <Card className="gap-3">
        <p className="m-0 text-[13px] font-medium text-muted-foreground">Started – stopped</p>
        <p className="m-0 font-mono text-[28px] font-semibold tabular-nums">
          {PREVIEW_START}–{PREVIEW_STOP}
        </p>
        <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label="Elapsed" value={formatMinutes(WINDOW_MIN)} />
          <Fact label="Running, net of downtime" value={formatMinutes(WINDOW_MIN - downtimeMin)} />
        </dl>
      </Card>
      <DowntimeList />
      <FormActions className="md:sticky md:bottom-4 md:z-10 md:rounded-card md:border md:border-border md:bg-card/95 md:p-2 md:shadow-sm">
        <Button onClick={showCounting}>Count & QC</Button>
      </FormActions>
    </>
  );
}

function CountingPanel({
  evaluation,
  viewer,
}: {
  evaluation: LogEvaluation;
  viewer: "supervisor" | "operator";
}) {
  const run = usePressDemo().pr42;
  const cast = castByCode(run.castCode);
  const weighedG = run.billets.reduce((sum, row) => sum + (parseNonNegKgG(row.kgText) ?? 0), 0);
  const shortBook = weighedG > kgToG(cast.onHandKg);
  const driftKg = parseOptionalKg(run.driftText);
  const drift = driftKg === null ? null : driftPercent(driftKg, SECTION.latestKg);

  return (
    <>
      <Stepper steps={[...COUNT_STEPS]} current={run.step} />
      {run.step === 0 ? (
        <Card className="gap-4">
          <Field label="Cast" hint="Heaviest billet stock first. A spectro fail does not block the pick.">
            <Select
              aria-label="Cast"
              value={run.castCode}
              onValueChange={setCast}
              options={CASTS.map((item) => ({
                value: item.code,
                label: `${item.code} · ${formatKgTotal(item.onHandKg)} kg${item.closed ? " · closed" : ""}${item.spectroFail ? " · spectro fail" : ""}`,
              }))}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Chip tone="neutral">{formatKgTotal(cast.onHandKg)} kg billet stock</Chip>
            {cast.closed ? <Chip tone="neutral">Closed</Chip> : null}
            {cast.spectroFail ? <Chip tone="red">Spectro fail</Chip> : null}
          </div>
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">
            One cast on a run. A second cast is a new run. Close means no more melts, not that the billets are gone.
          </p>
          {run.billets.map((row, index) => (
            <div key={row.id} className="grid grid-cols-1 gap-3 rounded-card bg-surface-sunken p-3 md:grid-cols-3">
              <Field label={index === 0 ? "Billet length" : "Length"}>
                <Select
                  aria-label="Billet length"
                  value={String(row.lengthMm)}
                  onValueChange={(value) => updateBillet(row.id, { lengthMm: Number(value) })}
                  options={BILLET_LENGTHS}
                />
              </Field>
              <Field label="Count">
                <NumberInput
                  value={row.countText}
                  onValueChange={(text) => updateBillet(row.id, { countText: text })}
                  decimal={false}
                  suffix="billets"
                />
              </Field>
              <Field label="Weighed kg">
                <NumberInput
                  value={row.kgText}
                  onValueChange={(text) => updateBillet(row.id, { kgText: text })}
                  suffix="kg"
                />
              </Field>
              {run.billets.length > 1 ? (
                <Button variant="ghost" onClick={() => removeBillet(row.id)}>
                  Remove length
                </Button>
              ) : null}
            </div>
          ))}
          <Button variant="secondary" onClick={addBillet} disabled={run.billets.length >= 10}>
            Add a length
          </Button>
          {shortBook ? (
            <div className="flex flex-col gap-3 rounded-card border border-border px-4 py-3">
              <p className="m-0 text-[15px] font-semibold leading-6">
                Billet book has {formatKgTotal(cast.onHandKg)} kg. Close will not post a negative row.
              </p>
              <Field label="Kg to post" hint="Recovery uses this figure, not the weighed kg.">
                <NumberInput value={run.postedInputText} onValueChange={setPostedInput} suffix="kg" />
              </Field>
              <Field label="Short book reason" hint="Written on the run and on the cast trace.">
                <TextArea value={run.billetShortReason} onChangeText={setBilletShortReason} rows={3} />
              </Field>
            </div>
          ) : null}
        </Card>
      ) : null}

      {run.step === 1 ? (
        <Card className="gap-4">
          {run.cuts.map((cut) => {
            const order = orderByNumber(cut.salesOrder);
            const pcs = parseNonNegInt(cut.pcsText);
            const theoretical = pcs === null ? null : theoreticalGoodG(pcs, cut.cutLengthMm, SECTION.latestMilli);
            return (
              <div key={cut.id} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="min-w-0 md:col-span-2">
                  <p className="m-0 font-semibold">
                    {order?.customer ?? cut.salesOrder}, {order?.city} · {cut.salesOrder}
                  </p>
                  <p className="m-0 text-[14px] text-muted-foreground">
                    {lengthLabel(cut.cutLengthMm)} · released {cut.releasedPcs} pcs
                  </p>
                </div>
                <Field label="Pieces">
                  <NumberInput
                    value={cut.pcsText}
                    onValueChange={(text) => updateCut(cut.id, { pcsText: text })}
                    decimal={false}
                    suffix="pcs"
                  />
                </Field>
                <Field
                  label="Weighed kg"
                  hint={
                    theoretical === null
                      ? "Good kg is weighed. The reading is not copied in."
                      : `Latest reading, not the weight: ${formatKg(gToKg(theoretical))} kg.`
                  }
                >
                  <NumberInput
                    value={cut.kgText}
                    onValueChange={(text) => updateCut(cut.id, { kgText: text })}
                    suffix="kg"
                  />
                </Field>
              </div>
            );
          })}
          <Field label="Pressed length" hint="Optional. Pieces × length is checked only when this is set.">
            <NumberInput
              value={run.pressedLengthText}
              onValueChange={setPressedLength}
              decimal={false}
              suffix="mm"
            />
          </Field>
        </Card>
      ) : null}

      {run.step === 2 ? (
        <Card className="gap-4">
          <Field label="Butt" hint="Stored as discard. Not typed into the recovery.">
            <NumberInput value={run.buttText} onValueChange={setButt} suffix="kg" />
          </Field>
          <Field label="Ends" hint="Cut ends. Not typed into the recovery.">
            <NumberInput value={run.endsText} onValueChange={setEnds} suffix="kg" />
          </Field>
        </Card>
      ) : null}

      {run.step === 3 ? (
        <Card className="gap-4">
          <Field label="Reject kg" hint="Empty is not a check. Zero is checked, none.">
            <NumberInput value={run.rejectText} onValueChange={setReject} suffix="kg" />
          </Field>
          {(parseNonNegKgG(run.rejectText) ?? -1) === 0 ? <Chip tone="green">Checked, none</Chip> : null}
          {(parseNonNegKgG(run.rejectText) ?? 0) > 0 ? (
            <>
              <Field label="Reason">
                <Select
                  aria-label="Reject reason"
                  value={run.rejectReason || "surface"}
                  onValueChange={setRejectReason}
                  options={QC_REASONS.map((item) => ({ value: item.code, label: `${item.code} · ${item.label}` }))}
                />
              </Field>
              <Field label="Note" hint={run.rejectReason === "other" ? "Required for other." : "Optional."}>
                <TextArea value={run.rejectNote} onChangeText={setRejectNote} rows={3} />
              </Field>
            </>
          ) : null}
        </Card>
      ) : null}

      {run.step === 4 ? (
        <Card className="gap-4">
          <Field label="Press remark" hint="Lands on the die card with this run. Empty is stored as blank.">
            <TextArea value={run.pressRemark} onChangeText={setPressRemark} rows={3} />
          </Field>
          <Field label="Die remark" hint="The operator remark for this load. The die room does not re-key it.">
            <TextArea value={run.dieRemark} onChangeText={setDieRemark} rows={3} />
          </Field>
          <Field label="Drift reading" hint={`Last reading ${formatKg(SECTION.latestKg, 3)} kg per 12 ft. Optional.`}>
            <NumberInput value={run.driftText} onValueChange={setDrift} suffix="kg" />
          </Field>
          {driftKg !== null && drift !== null ? (
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={inBand(driftKg) ? "green" : "amber"}>{inBand(driftKg) ? "In band" : "Out of band"}</Chip>
              <p className="m-0 text-[15px] tabular-nums">
                Drift {drift >= 0 ? "+" : ""}
                {drift.toFixed(1)}% from the last reading.
              </p>
            </div>
          ) : null}
          {evaluation.messages.includes("No billets, no recovery.") ? (
            <p className="m-0 text-[18px] font-semibold">No billets, no recovery.</p>
          ) : evaluation.preview ? (
            <div className="rounded-card bg-surface-sunken px-4 py-3">
              <p className="m-0 text-[13px] font-medium text-muted-foreground">Recovery preview, not saved</p>
              <p className="m-0 font-display text-[40px] font-extrabold tabular-nums leading-none">
                {formatRecoveryBp(evaluation.preview.recoveryBp)}
              </p>
              <p className="m-0 mt-2 text-[14px] leading-6">There is no field for it.</p>
              {evaluation.preview.balanceWarn ? (
                <p className="m-0 mt-2 text-[14px] leading-6">
                  Balance {formatKgG(evaluation.preview.balanceG)} kg is {formatRecoveryBp(Math.abs(evaluation.preview.balanceBp))} of
                  input. Over 2%. Stored, not a block.
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {evaluation.messages.length > 0 ? (
        <ul id="log-block" className="m-0 flex list-none flex-col gap-1 p-0" aria-live="polite">
          {evaluation.messages.map((message) => (
            <li key={message} className="text-[15px] font-medium leading-6 text-destructive">
              {message}
            </li>
          ))}
        </ul>
      ) : null}

      <FormActions className="md:sticky md:bottom-4 md:z-10 md:rounded-card md:border md:border-border md:bg-card/95 md:p-2 md:shadow-sm">
        {run.step > 0 ? (
          <Button variant="secondary" onClick={() => setStep(run.step - 1)}>
            Back
          </Button>
        ) : null}
        {run.step < COUNT_STEPS.length - 1 ? (
          <Button onClick={() => setStep(run.step + 1)}>Next</Button>
        ) : viewer === "supervisor" ? (
          <Button disabled={!evaluation.canLog} aria-describedby="log-block" onClick={() => logRun()}>
            Log run
          </Button>
        ) : (
          <Button disabled>Waiting for the supervisor to log</Button>
        )}
      </FormActions>
    </>
  );
}

function LoggedPanel() {
  const run = usePressDemo().pr42;
  const snapshot = run.logged;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!snapshot) return null;

  return (
    <>
      <Card className="gap-4">
        <div>
          <p className="m-0 text-[13px] font-medium text-muted-foreground">Recovery, saved on this preview</p>
          <p className="m-0 font-display text-[52px] font-extrabold leading-none tabular-nums">
            {formatRecoveryBp(snapshot.recoveryBp)}
          </p>
          <p className="m-0 mt-2 text-[15px] font-medium">Calculated. It is not entered.</p>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Fact label="Input posted" value={`${formatKgG(snapshot.inputG)} kg`} mono />
          <Fact label="Input weighed" value={`${formatKgG(snapshot.inputWeighedG)} kg`} mono />
          <Fact label="Good" value={`${formatKgG(snapshot.goodG)} kg · ${snapshot.goodPcs} pcs`} mono />
          <Fact label="Butt" value={`${formatKgG(snapshot.discardG)} kg`} mono />
          <Fact label="Ends" value={`${formatKgG(snapshot.endsG)} kg`} mono />
          <Fact label="Rejects" value={`${formatKgG(snapshot.rejectG)} kg`} mono />
        </dl>
        {snapshot.balanceWarn ? (
          <Chip tone="amber">
            Balance {formatKgG(snapshot.balanceG)} kg · {formatRecoveryBp(Math.abs(snapshot.balanceBp))} of input. Over 2%.
          </Chip>
        ) : null}
        {snapshot.billetShortReason ? (
          <p className="m-0 text-[14px] leading-6">Short book: {snapshot.billetShortReason}</p>
        ) : null}
        <p className="m-0 text-[16px] font-semibold leading-6">{pressedSentence(snapshot)}</p>
        <BakiList pressed={snapshot.lines} />
        <p className="m-0 text-[14px] leading-6 text-muted-foreground">
          Logged by {PEOPLE.supervisor}. Ageing has not loaded these lines. Baki waits for dispatch.
        </p>
      </Card>
      {run.reopen === "requested" ? (
        <Card className="gap-3">
          <Chip tone="amber">Reopen requested</Chip>
          <p className="m-0 text-[15px] leading-6">{run.reopenNote}</p>
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">
            {PEOPLE.supervisor} requested this. You cannot approve your own request.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled
              onClick={() => setError(decideReopen(false))}
            >
              Approve as {PEOPLE.supervisor}
            </Button>
            <Button
              onClick={() => {
                const message = decideReopen(true);
                setError(message);
              }}
            >
              Approve as {PEOPLE.owner}
            </Button>
          </div>
          {error ? <p className="m-0 text-[14px] font-medium text-destructive">{error}</p> : null}
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Request reopen
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Request reopen"
        description="A manager who is not you has to approve. Ageing has not loaded these lines."
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const message = requestReopen(note);
                setError(message);
                if (!message) setOpen(false);
              }}
            >
              Request
            </Button>
          </>
        }
      >
        <Field label="Note" error={error ?? undefined}>
          <TextArea value={note} onChangeText={setNote} rows={3} />
        </Field>
      </Dialog>
    </>
  );
}

function BakiList({ pressed }: { pressed: { salesOrder: string; kgG: number; pcs: number }[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
      {ORDERS.map((order) => {
        const row = pressed.find((line) => line.salesOrder === order.number);
        return (
          <li key={order.number} className="rounded-card border border-border px-4 py-3">
            <p className="m-0 font-mono text-[14px] font-semibold">{order.number}</p>
            <p className="m-0 text-[14px] text-muted-foreground">
              {order.customer}, {order.city}
            </p>
            <dl className="m-0 mt-2 grid grid-cols-3 gap-2">
              <Fact label="Ordered" value={`${formatKgTotal(order.orderedKg)} kg`} />
              <Fact label="Dispatched" value={`${formatKgTotal(order.dispatchedKg)} kg`} />
              <Fact label="Baki" value={`${formatKgTotal(bakiKg(order))} kg`} />
            </dl>
            <p className="m-0 mt-2 text-[14px] tabular-nums">
              Pressed {row ? `${formatKgG(row.kgG)} kg · ${row.pcs} pcs` : "—"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function DowntimeList() {
  const rows = usePressDemo().pr42.downtime;
  return (
    <Card className="gap-2">
      <h2 className="m-0 text-[15px] font-semibold">Stoppages</h2>
      <p className="m-0 text-[13px] text-muted-foreground">A stoppage is a row, not a status.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[15px]">
            <span className="font-mono">{row.reason}</span>
            <span className="text-muted-foreground">{reasonLabel(row.reason)}</span>
            <span className="ml-auto tabular-nums">{row.open ? "Open" : `${row.minutes} min`}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function phaseWord(phase: ClockPhase): string {
  if (phase === "running") return "Running";
  if (phase === "stopped") return "Stopped";
  if (phase === "logged") return "Logged";
  return "Counting";
}

function phaseTone(phase: ClockPhase): "green" | "blue" | "amber" {
  if (phase === "running" || phase === "logged") return "green";
  if (phase === "stopped") return "amber";
  return "blue";
}
