import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Sheet } from "@orrn/ui/components/sheet";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { trpcClient } from "@/shared/utils/trpc";

import { listedReason, MATCH_BATCH, planBulk, summariseBulk, type BulkOutcome, type BulkPlan, type NameMatch } from "./bulk-attach";
import { UploadPutError, uploadMatchedFile } from "./die-file-upload";
import { refusalText } from "./die-room-model";
import { useRefreshDieRoom } from "./use-die-room";

type FileState = { state: "waiting" | "uploading" | "saved" | "error"; error?: string; pressDrawing?: boolean };

type Stage =
  | { name: "pick"; error?: string }
  | { name: "matching" }
  | { name: "ready"; files: File[]; plan: BulkPlan }
  | { name: "uploading"; files: File[]; plan: BulkPlan; states: Record<number, FileState>; current: number }
  | { name: "done"; files: File[]; plan: BulkPlan; states: Record<number, FileState> };

/**
 * Attach drawings in bulk (FP-DR-19, `/dies` menu): pick many files, the server reads the names
 * (`12170.pdf` -> die 12170, `12170-1.cdr` -> copy 12170-1), the files go up one at a time, and
 * names that match nothing are listed, never guessed.
 */
export function BulkDrawingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  // Mounted only while open: closing forgets the pick.
  return open ? <Body onOpenChange={onOpenChange} /> : null;
}

function Body({ onOpenChange }: { onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const busy = stage.name === "matching" || stage.name === "uploading";

  const pick = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    setStage({ name: "matching" });
    try {
      const matches: NameMatch[] = [];
      for (let i = 0; i < files.length; i += MATCH_BATCH) {
        const names = files.slice(i, i + MATCH_BATCH).map((f) => f.name);
        matches.push(...((await trpcClient.dieInstance.files.matchNames.query({ names })) as NameMatch[]));
      }
      // A PDF is the press drawing only for the first PDF of a section across the whole pick.
      const taken = new Set<string>();
      for (const m of matches) {
        if (m.pressDrawing && m.sectionId) {
          if (taken.has(m.sectionId)) m.pressDrawing = false;
          else taken.add(m.sectionId);
        }
      }
      setStage({ name: "ready", files, plan: planBulk(matches) });
    } catch (e) {
      setStage({ name: "pick", error: refusalText(e, t) });
    }
  };

  const run = async (files: File[], plan: BulkPlan, only?: number[]) => {
    const todo = plan.upload.filter((e) => !only || only.includes(e.index));
    const states: Record<number, FileState> = Object.fromEntries(
      plan.upload.map((e) => [e.index, only && !only.includes(e.index) ? ((stage.name === "done" ? stage.states[e.index] : undefined) ?? { state: "waiting" }) : { state: "waiting" }]),
    );
    const outcomes: BulkOutcome[] = [];
    for (const entry of todo) {
      states[entry.index] = { state: "uploading" };
      setStage({ name: "uploading", files, plan, states: { ...states }, current: entry.index });
      const m = entry.match;
      try {
        const saved = await uploadMatchedFile({
          file: files[entry.index]!,
          kind: m.kind!,
          sectionId: m.sectionId,
          dieInstanceId: m.dieInstanceId,
          pressDrawing: m.pressDrawing,
        });
        states[entry.index] = { state: "saved", pressDrawing: saved.pressDrawing };
        outcomes.push({ index: entry.index, ok: true, pressDrawing: saved.pressDrawing });
      } catch (e) {
        const error = e instanceof UploadPutError ? t("dieRoom.bulk.putFailed") : refusalText(e, t);
        states[entry.index] = { state: "error", error };
        outcomes.push({ index: entry.index, ok: false, error });
      }
    }
    await refresh();
    const sum = summariseBulk(plan, outcomes);
    if (sum.saved > 0) toast.success(t("dieRoom.bulk.savedToast", { count: sum.saved }));
    setStage({ name: "done", files, plan, states: { ...states } });
  };

  const failedIndexes = stage.name === "done" ? stage.plan.upload.filter((e) => stage.states[e.index]?.state === "error").map((e) => e.index) : [];

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o && !busy) onOpenChange(false);
      }}
      dismissible={!busy}
      title={t("dieRoom.bulk.title")}
      description={t("dieRoom.bulk.intro")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {stage.name === "done" ? t("common.close") : t("common.cancel")}
          </Button>
          {stage.name === "ready" ? (
            <Button
              disabled={stage.plan.upload.length === 0}
              onClick={() => void run(stage.files, stage.plan)}
              data-testid="bulk-start"
            >
              {t("dieRoom.bulk.attach", { count: stage.plan.upload.length })}
            </Button>
          ) : null}
          {stage.name === "done" && failedIndexes.length > 0 ? (
            <Button onClick={() => void run(stage.files, stage.plan, failedIndexes)} data-testid="bulk-retry">
              {t("dieRoom.bulk.retry", { count: failedIndexes.length })}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="bulk-sheet">
        {stage.name === "pick" || stage.name === "matching" ? (
          <div className="flex flex-col gap-3">
            <label htmlFor={inputId} className="text-[14px] font-semibold">
              {t("dieRoom.bulk.pick")}
            </label>
            <input
              ref={input}
              id={inputId}
              type="file"
              multiple
              disabled={stage.name === "matching"}
              accept=".pdf,.cdr,.dwg,.jpg,.jpeg,.png,.webp,image/*"
              onChange={(e) => void pick(e.target.files)}
              className="min-h-11 text-[14px]"
              data-testid="bulk-input"
            />
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-5 text-muted-foreground">
              <li>{t("dieRoom.bulk.ruleSection")}</li>
              <li>{t("dieRoom.bulk.ruleCopy")}</li>
              <li>{t("dieRoom.bulk.ruleDrawing")}</li>
              <li>{t("dieRoom.files.limits")}</li>
            </ul>
            {stage.name === "matching" ? (
              <p role="status" className="m-0 text-[14px] text-muted-foreground">
                {t("dieRoom.bulk.reading")}
              </p>
            ) : null}
            {stage.name === "pick" && stage.error ? (
              <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
                {stage.error}
              </p>
            ) : null}
          </div>
        ) : (
          <Review stage={stage} />
        )}
      </div>
    </Sheet>
  );
}

function Review({ stage }: { stage: Extract<Stage, { name: "ready" | "uploading" | "done" }> }) {
  const { t } = useT();
  const { plan, files } = stage;
  const states = stage.name === "ready" ? null : stage.states;
  const total = plan.upload.length;
  const finished = states ? plan.upload.filter((e) => states[e.index]?.state === "saved" || states[e.index]?.state === "error").length : 0;
  const pct = total === 0 ? 0 : Math.round((finished / total) * 100);
  const label = t("dieRoom.bulk.progress", { done: finished, total });
  const sum = states
    ? summariseBulk(
        plan,
        plan.upload.flatMap((e): BulkOutcome[] => {
          const s = states[e.index];
          return s?.state === "saved" ? [{ index: e.index, ok: true, pressDrawing: Boolean(s.pressDrawing) }] : s?.state === "error" ? [{ index: e.index, ok: false, error: s.error ?? "" }] : [];
        }),
      )
    : null;

  return (
    <div className="flex flex-col gap-4">
      {stage.name !== "ready" ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[15px] font-semibold tabular-nums" aria-live="polite" data-testid="bulk-progress-text">
            {label}
          </p>
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className="h-full origin-left rounded-full bg-primary transition-transform duration-[var(--dur-base)] motion-reduce:transition-none"
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
        </div>
      ) : null}

      {stage.name === "done" && sum ? (
        <p className="m-0 text-[14px] leading-6" role="status" data-testid="bulk-summary">
          {t("dieRoom.bulk.summary", { saved: sum.saved, failed: sum.failed, already: sum.already, notMatched: sum.notMatched })}
        </p>
      ) : null}

      {plan.upload.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="bulk-upload">
          <h3 id="bulk-upload" className="m-0 text-[15px] font-semibold">
            {t("dieRoom.bulk.willAttach", { count: plan.upload.length })}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="bulk-upload">
            {plan.upload.map((e) => {
              const s = states?.[e.index];
              return (
                <li key={e.index} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-3" data-testid={`bulk-file-${files[e.index]?.name}`}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 font-mono text-[14px] font-semibold break-all">{e.match.name}</span>
                    {s?.state === "saved" ? (
                      <Chip tone="green" truncate={false}>
                        {t("dieRoom.bulk.state.saved")}
                      </Chip>
                    ) : s?.state === "uploading" ? (
                      <Chip tone="blue" truncate={false}>
                        {t("dieRoom.bulk.state.uploading")}
                      </Chip>
                    ) : s?.state === "error" ? (
                      <Chip tone="red" truncate={false}>
                        {t("dieRoom.bulk.state.error")}
                      </Chip>
                    ) : null}
                  </div>
                  <p className="m-0 text-[13px] text-muted-foreground">
                    {e.match.status === "copy" ? t("dieRoom.bulk.toCopy", { target: e.match.target ?? "" }) : t("dieRoom.bulk.toSection", { target: e.match.target ?? "" })}
                    {e.match.pressDrawing ? ` · ${t("dieRoom.bulk.asDrawing")}` : ""}
                  </p>
                  {s?.state === "error" ? (
                    <p role="alert" className="m-0 text-[13px] leading-5 font-medium text-destructive">
                      {s.error}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.bulk.nothingToAttach")}</p>
      )}

      {plan.already.length > 0 ? (
        <section className="flex flex-col gap-1" aria-labelledby="bulk-already">
          <h3 id="bulk-already" className="m-0 text-[15px] font-semibold">
            {t("dieRoom.bulk.alreadyTitle", { count: plan.already.length })}
          </h3>
          <p className="m-0 text-[13px] text-muted-foreground" data-testid="bulk-already">
            {plan.already.map((e) => e.match.name).join(", ")}
          </p>
        </section>
      ) : null}

      {plan.listed.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="bulk-listed">
          <h3 id="bulk-listed" className="m-0 text-[15px] font-semibold">
            {t("dieRoom.bulk.notMatchedTitle", { count: plan.listed.length })}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="bulk-unmatched">
            {plan.listed.map((e) => (
              <li key={e.index} className="flex min-w-0 flex-col gap-0.5 rounded-card border border-dashed border-border p-3">
                <span className="font-mono text-[14px] font-semibold break-all">{e.match.name}</span>
                <span className="text-[13px] text-muted-foreground">{t(`dieRoom.bulk.reason.${listedReason(e.match.status)}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
