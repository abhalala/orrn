import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { TextArea } from "@orrn/ui/components/input";
import { useState } from "react";

import { BandPositionChip, PercentChip } from "./drift-chips";
import {
  DEMO_DAY,
  LIFT_REASON,
  bandPosition,
  copyByCode,
  driftTone,
  effectiveBand,
  formatBandRange,
  formatKgPerM,
  formatMilliKg,
  formatPctTenth,
  formatWallMm,
  gramsOffMax,
  latestMilli,
  pctTenth,
  type Band,
} from "./fixtures";

type Phase = "form" | "pending" | "applied" | "rejected";

export function LiftScreen() {
  const { section, copy } = copyByCode("12170-2");
  const target = section.bands[0];
  const current = effectiveBand(section, copy);
  const latest = latestMilli(copy) ?? 0;
  const [phase, setPhase] = useState<Phase>("form");
  const [rank, setRank] = useState("2");
  const [reason, setReason] = useState(LIFT_REASON);
  const [rankError, setRankError] = useState<string | null>(null);

  const applied = phase === "applied";
  const shownBand: Band = applied && target ? target : current;
  const tenth = pctTenth(latest, shownBand.weightMinG);
  const tone = driftTone(latest, shownBand.weightMinG);
  const position = bandPosition(latest, shownBand);
  const aboveG = gramsOffMax(latest, current);

  const propose = () => {
    const rankN = Number(rank);
    if (!Number.isInteger(rankN) || rankN < 1) {
      setRankError("Rank is a whole number, 1 or more.");
      return;
    }
    if (!reason.trim()) {
      setRankError("A reason is required.");
      return;
    }
    setRankError(null);
    setPhase("pending");
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="min-w-0">
          <p className="m-0 text-[13px] font-semibold text-muted-foreground">This code will not change</p>
          <p className="m-0 font-mono text-[40px] font-semibold leading-none tabular-nums tracking-[-0.03em]">{copy.code}</p>
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">Tier {applied ? rank : copy.tierRank} · {section.series}</p>
          <dl className="m-0 grid grid-cols-1 gap-3">
            <div>
              <dt className="text-[12px] font-medium text-muted-foreground">{applied ? "Band now" : "Current band"}</dt>
              <dd className="m-0 font-mono text-[15px] font-semibold tabular-nums">
                {formatWallMm(shownBand.wallTenthMm)} mm · {formatBandRange(shownBand)} kg/12 ft
              </dd>
            </div>
            <div>
              <dt className="text-[12px] font-medium text-muted-foreground">Reading</dt>
              <dd className="m-0 font-mono text-[15px] tabular-nums">
                {formatMilliKg(latest)} kg/12 ft · {formatKgPerM(latest)} kg/m
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <PercentChip tone={tone} label={formatPctTenth(tenth)} />
            <BandPositionChip position={position} />
            <Badge tone="neutral" className="font-mono tabular-nums">
              {formatBandRange(shownBand)} kg/12 ft
            </Badge>
          </div>
          {!applied && aboveG > 0 ? (
            <p className="m-0 text-[15px] font-semibold tabular-nums">above by {aboveG.toLocaleString("en-IN")} g</p>
          ) : null}
          {applied ? <p className="m-0 text-[14px] leading-6">Code stays {copy.code}.</p> : null}
        </Card>

        <Card className="min-w-0">
          <CardTitle>Propose lift</CardTitle>
          {target ? (
            <p className="m-0 text-[14px] leading-6">
              Target band{" "}
              <span className="font-mono tabular-nums">
                {formatWallMm(target.wallTenthMm)} mm · {formatBandRange(target)} kg/12 ft
              </span>
              {target.label ? ` (${target.label})` : ""}. The old band keeps an empty slot.
            </p>
          ) : null}
          {phase === "rejected" ? (
            <p role="status" className="m-0 text-[14px] font-medium">
              Rejected. {copy.code} stays on {formatBandRange(current)}.
            </p>
          ) : null}
          {phase === "applied" ? (
            <p role="status" className="m-0 text-[14px] font-semibold">
              Lift applied. Waiting is over. A manager approved it in this preview.
            </p>
          ) : (
            <>
              <Field label="Rank" error={rankError ?? undefined}>
                <NumberInput value={rank} onValueChange={setRank} decimal={false} />
              </Field>
              <Field label="Reason">
                <TextArea value={reason} onChangeText={setReason} rows={3} />
              </Field>
              <FormActions sticky={false}>
                {phase === "pending" ? (
                  <Button variant="secondary" onClick={() => setPhase("rejected")}>
                    Reject
                  </Button>
                ) : null}
                {phase === "pending" ? (
                  <>
                    <Button variant="secondary" disabled>
                      Waiting for a manager
                    </Button>
                    <Button onClick={() => setPhase("applied")}>Approve as manager</Button>
                  </>
                ) : (
                  <Button onClick={propose}>Propose lift</Button>
                )}
              </FormActions>
              {phase === "pending" ? (
                <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                  Preview only. The requester cannot approve. Approve as manager applies the lift.
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>

      {applied ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card>
            <CardTitle>Primary band {formatBandRange(current)}</CardTitle>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              <li className="text-[14px] leading-6">12170-1 · still on this band</li>
              <li className="font-semibold">12170-2 lifted {DEMO_DAY}</li>
              <li className="text-[14px] leading-6 text-muted-foreground">12170-3 · at maker, slot still listed</li>
            </ul>
          </Card>
          {target ? (
            <Card>
              <CardTitle>Band {formatBandRange(target)} kg/12 ft{target.label ? ` (${target.label})` : ""}</CardTitle>
              <p className="m-0 flex flex-wrap items-center gap-2 text-[14px] leading-6">
                <span className="font-mono font-semibold tabular-nums">{copy.code}</span>
                <Badge tone="neutral">Tier {rank}</Badge>
                <BandPositionChip position={bandPosition(latest, target)} />
              </p>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
