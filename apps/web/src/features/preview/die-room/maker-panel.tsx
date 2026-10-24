import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useState } from "react";

import { BandPositionChip, PercentChip, StatusChip } from "./drift-chips";
import {
  DEMO_DAY,
  JOB_DM4,
  PARTIES,
  PRESS_LINES,
  bandPosition,
  copyByCode,
  driftTone,
  effectiveBand,
  formatKgPerM,
  formatMilliKg,
  formatPctTenth,
  latestMilli,
  parseKgToMilli,
  pctTenth,
  purposeLabel,
  type CopyStatus,
} from "./fixtures";

type IssuePhase = "sent" | "available" | "issued";

export function MakerOwnerScreen() {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <MakerPanel />
      <OwnerPanel />
    </div>
  );
}

function MakerPanel() {
  const { copy } = copyByCode(JOB_DM4.copyCode);
  const [phase, setPhase] = useState<IssuePhase>("sent");
  const [trialText, setTrialText] = useState("");
  const [trialMilli, setTrialMilli] = useState<number | null>(copy.trialMilli);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [line, setLine] = useState<(typeof PRESS_LINES)[number]["id"]>("line-1");

  const status: CopyStatus = phase === "sent" ? "at_maker" : phase === "issued" ? "in_use" : "available";
  const lineName = PRESS_LINES.find((row) => row.id === line)?.name ?? "Press 1";

  const saveTrial = () => {
    if (trialMilli !== null) {
      setTrialError("Trial weight is already set. It does not become the current weight.");
      return;
    }
    const milli = parseKgToMilli(trialText);
    if (milli === null || milli < 1) {
      setTrialError("Enter the trial weight in kg per 12 ft.");
      return;
    }
    setTrialMilli(milli);
    setTrialError(null);
  };

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>Maker</CardTitle>
        <StatusChip status={status} />
      </div>
      <p className="m-0 font-mono text-[22px] font-semibold tabular-nums">{JOB_DM4.number}</p>
      <dl className="m-0 grid grid-cols-1 gap-2 text-[14px] leading-6">
        <div>
          <dt className="text-[12px] font-medium text-muted-foreground">Copy</dt>
          <dd className="m-0 font-mono font-semibold tabular-nums">{copy.code}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium text-muted-foreground">Die maker</dt>
          <dd className="m-0">
            {JOB_DM4.makerName}, {JOB_DM4.city}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium text-muted-foreground">Purpose</dt>
          <dd className="m-0">{purposeLabel(JOB_DM4.purpose)}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium text-muted-foreground">Sent</dt>
          <dd className="m-0">{JOB_DM4.sentOn}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium text-muted-foreground">Status</dt>
          <dd className="m-0 capitalize">{phase === "sent" ? "sent" : "received"}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium text-muted-foreground">Current weight</dt>
          <dd className="m-0">No reading</dd>
        </div>
      </dl>
      {trialMilli !== null ? (
        <p className="m-0 text-[14px] leading-6">
          Trial {formatMilliKg(trialMilli)} kg/12 ft. This does not become the current weight.
        </p>
      ) : null}

      {phase === "sent" ? (
        <FormActions sticky={false}>
          <Button onClick={() => setPhase("available")}>Receive</Button>
        </FormActions>
      ) : (
        <>
          {phase === "available" ? (
            <p className="m-0 text-[13px] text-muted-foreground">Received {DEMO_DAY}. No longer at maker.</p>
          ) : (
            <p className="m-0 text-[14px] font-semibold">Issued to {lineName}.</p>
          )}
          {trialMilli === null ? (
            <Field label="Trial weight" hint="kg per 12 ft. For this preview, 5.920." error={trialError ?? undefined}>
              <NumberInput value={trialText} onValueChange={setTrialText} suffix="kg" />
            </Field>
          ) : null}
          {trialMilli === null ? (
            <Button variant="secondary" onClick={saveTrial}>
              Save trial
            </Button>
          ) : null}
          {phase === "available" ? (
            <SegmentedControl
              label="Press line"
              value={line}
              onChange={setLine}
              options={PRESS_LINES.map((row) => ({ value: row.id, label: row.name }))}
            />
          ) : null}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={phase === "available" ? "primary" : "secondary"}
          disabled={phase !== "available"}
          aria-describedby={phase === "sent" ? "issue-block" : undefined}
          onClick={() => setPhase("issued")}
        >
          Issue
        </Button>
        {phase === "sent" ? (
          <p id="issue-block" className="m-0 text-[14px] font-semibold">
            Out at Shreeji Dies
          </p>
        ) : null}
        {phase === "issued" ? (
          <Button variant="secondary" onClick={() => setPhase("available")}>
            Return
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function OwnerPanel() {
  const { section, copy } = copyByCode("31220-1");
  const band = effectiveBand(section, copy);
  const latest = latestMilli(copy);
  const tenth = latest === null ? null : pctTenth(latest, band.weightMinG);
  const [anshuBlocked, setAnshuBlocked] = useState(false);
  const [pending, setPending] = useState(false);
  const [granted, setGranted] = useState(false);
  const [anshuOnPlan, setAnshuOnPlan] = useState(false);
  const [bhaveshOnPlan, setBhaveshOnPlan] = useState(false);

  const putAnshu = () => {
    if (granted) {
      setAnshuOnPlan(true);
      setAnshuBlocked(false);
      return;
    }
    setAnshuBlocked(true);
  };

  return (
    <Card className="min-w-0">
      <CardTitle>Owner</CardTitle>
      <p className="m-0 font-mono text-[22px] font-semibold tabular-nums">{copy.code}</p>
      <p className="m-0 text-[14px] leading-6">
        {section.series} · owner {section.ownerName}
        {section.ownerCity ? `, ${section.ownerCity}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {latest !== null ? (
          <span className="font-mono text-[14px] tabular-nums">
            {formatMilliKg(latest)} kg/12 ft · {formatKgPerM(latest)} kg/m
          </span>
        ) : (
          <span>No reading</span>
        )}
        {tenth !== null ? <PercentChip tone={driftTone(latest, band.weightMinG)} label={formatPctTenth(tenth)} /> : null}
        <BandPositionChip position={bandPosition(latest, band)} />
      </div>

      <PlanRow
        title={`${PARTIES.anshu.name}, ${PARTIES.anshu.city} — 12 ft`}
        onPlan={anshuOnPlan}
        onPut={putAnshu}
      />
      {anshuBlocked && !granted ? (
        <div role="alert" className="flex flex-col gap-3 rounded-card border border-border bg-tone-red-tint px-4 py-3 text-tone-red-ink">
          <p className="m-0 text-[15px] font-semibold">This die belongs to Bhavesh Traders</p>
          {pending ? (
            <p className="m-0 text-[13px] leading-5">Waiting for a manager. The grant is for Anshu Aluminium only.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!pending ? (
              <Button variant="secondary" onClick={() => setPending(true)}>
                Request override
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPending(false);
                  }}
                >
                  Reject
                </Button>
                <Button
                  onClick={() => {
                    setGranted(true);
                    setPending(false);
                    setAnshuBlocked(false);
                    setAnshuOnPlan(true);
                  }}
                >
                  Approve as manager
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {granted ? (
        <p role="status" className="m-0 text-[13px] leading-5 text-muted-foreground">
          Override granted for {PARTIES.anshu.name} on {copy.code} only. {PARTIES.bhavesh.name} needs no override.
        </p>
      ) : null}

      <PlanRow
        title={`${PARTIES.bhavesh.name}, ${PARTIES.bhavesh.city} — 12 ft`}
        onPlan={bhaveshOnPlan}
        onPut={() => setBhaveshOnPlan(true)}
      />
    </Card>
  );
}

function PlanRow({ title, onPlan, onPut }: { title: string; onPlan: boolean; onPut: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface-sunken p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 min-w-0 text-[15px] font-semibold leading-6">{title}</p>
      {onPlan ? <Badge tone="success">On plan</Badge> : <Button onClick={onPut}>Put on plan</Button>}
    </div>
  );
}
