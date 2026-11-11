import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";

import {
  allowedActions,
  candidateStateKey,
  candidateTone,
  fitKeyOf,
  rowStateCounts,
  TARGET_KEY,
  useIngestActions,
  type CandidateSummary,
} from "../lib";
import { CandidateLink, chipTone, ReasonText, translateKey } from "./shared";

export function CandidateActions({ candidate, onDone }: { candidate: CandidateSummary; onDone?: () => void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const actions = useIngestActions();
  const [pending, setPending] = useState<"approve" | "hold" | "discard" | null>(null);
  const [failed, setFailed] = useState(false);
  const allowed = allowedActions(candidate, { merge: can(me, "ingest.merge"), upload: can(me, "ingest.upload") });

  const run = async (name: "approve" | "hold" | "discard") => {
    setPending(name);
    setFailed(false);
    try {
      await actions[name](candidate.id, candidate.serverSeq);
      onDone?.();
    } catch {
      setFailed(true);
      onDone?.();
    } finally {
      setPending(null);
    }
  };

  if (!allowed.approve && !allowed.hold && !allowed.discard) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {allowed.approve ? (
          <Can do="ingest.merge">
            <Button size="sm" loading={pending === "approve"} disabled={pending !== null} onClick={() => void run("approve")}>
              {t("ingest.action.approve")}
            </Button>
          </Can>
        ) : null}
        {allowed.hold ? (
          <Can do={["ingest.upload", "ingest.merge"]}>
            <Button size="sm" variant="secondary" loading={pending === "hold"} disabled={pending !== null} onClick={() => void run("hold")}>
              {t("ingest.action.hold")}
            </Button>
          </Can>
        ) : null}
        {allowed.discard ? (
          <Can do="ingest.upload">
            <Button size="sm" variant="ghost" loading={pending === "discard"} disabled={pending !== null} onClick={() => void run("discard")}>
              {t("ingest.action.discard")}
            </Button>
          </Can>
        ) : null}
      </div>
      {failed ? <p role="alert" className="m-0 text-[13px] text-destructive">{t("ingest.read.failed")}</p> : null}
    </div>
  );
}

export function CandidateCard({ candidate, onDone }: { candidate: CandidateSummary; onDone?: () => void }) {
  const { t } = useT();
  const title = candidate.target ? translateKey(t, TARGET_KEY(candidate.target)) : candidate.holeName ?? candidate.fileName;
  return (
    <li data-testid="ingest-candidate" data-state={candidate.state} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <CandidateLink id={candidate.id} className="font-display text-[18px] leading-snug font-bold tracking-[-0.02em] break-words">
            {title}
          </CandidateLink>
          <p className="m-0 text-[13px] leading-5 break-words text-muted-foreground">
            {candidate.fileName}
            {candidate.sheetName ? ` · ${candidate.sheetName}` : ""}
          </p>
        </div>
        <Chip tone={chipTone(candidateTone(candidate.state))} truncate={false}>
          {translateKey(t, candidateStateKey(candidate.state))}
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="neutral">{translateKey(t, fitKeyOf(candidate.fit))}</Chip>
        {candidate.openQuestions > 0 ? (
          <span className="text-[13px] font-medium text-tone-amber-ink">{t("ingest.group.needsYou")} {candidate.openQuestions}</span>
        ) : null}
      </div>
      <dl className="m-0 flex flex-wrap gap-x-4 gap-y-2">
        {rowStateCounts(candidate.counts).map((count) => (
          <div key={count.state} className="flex items-baseline gap-1.5">
            <dt className="text-[13px] text-muted-foreground">{translateKey(t, count.key)}</dt>
            <dd className="m-0 font-mono text-[14px] font-semibold tabular-nums">{count.count}</dd>
          </div>
        ))}
      </dl>
      <ReasonText code={candidate.reasonCode} detail={candidate.reasonDetail} />
      <CandidateActions candidate={candidate} onDone={onDone} />
    </li>
  );
}
