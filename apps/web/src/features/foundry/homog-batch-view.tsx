import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Stepper } from "@orrn/ui/components/stepper";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { TempSpark } from "@/features/ageing/sparkline";
import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { PlantInput } from "@/shared/components/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1, massUnit, whenText } from "@/shared/lib/fmt-text";
import { kgToG } from "./melt-form";
import { MASS_KG } from "@/shared/lib/plant-input";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import {
  HOMOG_STAGES,
  HOMOG_VERDICT_TONE,
  homogActions,
  homogStageIndex,
  homogTone,
  noteOk,
  pcsOf,
  readingX10,
  recipeBand,
  releaseNeedsNote,
  type HomogVerdict,
} from "./homog-model";
import { ErrorLine, Figure, FieldSelect, LoadFailed, Panel } from "./ui";

type Detail = inferRouterOutputs<AppRouter>["foundry"]["homog"]["get"];

const x10Text = (x10: number | null | undefined): string => (x10 === null || x10 === undefined ? "-" : (x10 / 10).toFixed(1));

function useHomogInvalidate() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: trpc.foundry.homog.pathKey() });
}

/** `/foundry/homog/$id`: stage steps, logs, readings, the soak, and the next step the status allows. */
export function HomogBatchScreen({ id }: { id: string }) {
  const { t } = useT();
  const query = useQuery({ ...trpc.foundry.homog.get.queryOptions({ id }), meta: INLINE_ERROR_META, refetchInterval: 30_000 });
  const back = { to: "/foundry/homog", label: t("fdy2.homog.title") };
  if (showsQueryError(query)) {
    return (
      <>
        <PageHeader title={t("fdy2.homog.title")} back={back} />
        <LoadFailed title={t("fdy2.homog.loadFailed")} onRetry={() => void query.refetch()} />
      </>
    );
  }
  if (!query.data) return <><PageHeader title={t("fdy2.homog.title")} back={back} /><Skeleton className="h-40 rounded-card" /></>;
  return <Batch d={query.data} back={back} />;
}

type Dlg = null | "line" | "reading" | "release" | "void";

function Batch({ d, back }: { d: Detail; back: { to: string; label: string } }) {
  const { t } = useT();
  const fmt = useFmt();
  const invalidate = useHomogInvalidate();
  const b = d.batch;
  const [dialog, setDialog] = useState<Dlg>(null);
  const actions = homogActions(b.status, b.soakOk, d.lines.length);
  const done = (message: string) => {
    toast.success(message);
    invalidate();
  };
  const start = useMutation(trpc.foundry.homog.start.mutationOptions({ onSuccess: () => done(t("fdy2.homog.batch.started")) }));
  const out = useMutation(
    trpc.foundry.homog.out.mutationOptions({
      onSuccess: (r) => done(t("fdy2.homog.batch.outDone", { verdict: t(`fdy2.homog.verdict.${r.verdict}`) })),
    }),
  );
  const hold = useMutation(trpc.foundry.homog.release.mutationOptions({ onSuccess: () => done(t("fdy2.homog.batch.held")) }));
  const releaseNote = useMutation(trpc.foundry.homog.release.mutationOptions({ onSuccess: () => { done(t("fdy2.homog.batch.released")); setDialog(null); } }));
  const voidIt = useMutation(trpc.foundry.homog.void.mutationOptions({ onSuccess: () => { done(t("fdy2.homog.batch.voided")); setDialog(null); } }));
  const [confirmOut, setConfirmOut] = useState(false);
  const recipe = t("fdy2.homog.recipe", { temp: x10Text(b.targetTempX10), tol: x10Text(b.toleranceX10), min: b.soakMin });
  const subtitle = [t("fdy2.homog.batch.furnaceLine", { code: b.furnaceCode }), b.alloy, recipe].join(" · ");
  const totalPcs = d.lines.reduce((s, l) => s + l.pcs, 0);
  const totalG = d.lines.reduce((s, l) => s + l.kgG, 0);
  const needsNote = releaseNeedsNote(b.status, b.soakOk);
  return (
    <>
      <PageHeader title={b.number} subtitle={subtitle} back={back} actions={<Chip tone={homogTone(b.status)} truncate={false}>{t(`fdy2.homog.status.${b.status}`)}</Chip>} />
      {b.status === "void" ? (
        <Panel id="void-panel" title={t("fdy2.homog.status.void")} className="border-tone-red-ink/30 bg-tone-red-tint/40" testId="homog-void-note">
          <p className="m-0 text-[15px]">{b.decisionNote ? t("fdy2.homog.batch.reasonOnRecord", { note: b.decisionNote }) : t("fdy2.homog.status.void")}</p>
        </Panel>
      ) : (
        <Stepper steps={HOMOG_STAGES.map((s) => t(`fdy2.homog.stage.${s}`))} current={homogStageIndex(b.status)} />
      )}
      <dl className="m-0 grid grid-cols-2 gap-4 rounded-card border border-border bg-card p-4 sm:grid-cols-4 sm:p-5">
        <Figure label={t("fdy2.homog.col.pieces")} value={totalPcs} />
        <Figure label={t("fdy2.homog.col.weight")} value={`${kgGrouped1(fmt, totalG)} ${massUnit(fmt)}`} />
        <Figure label={t("fdy2.homog.batch.inLabel")} value={b.inAt ? whenText(fmt, b.inAt) : "-"} />
        <Figure label={t("fdy2.homog.batch.outLabel")} value={b.outAt ? whenText(fmt, b.outAt) : "-"} />
      </dl>
      {b.status === "released" && b.decisionNote ? <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.homog.batch.reasonOnRecord", { note: b.decisionNote })}</p> : null}
      <LinesPanel d={d} editable={actions.load} onAdd={() => setDialog("line")} />
      {b.inAt ? <SoakPanel d={d} onAdd={actions.reading ? () => setDialog("reading") : null} /> : null}
      {actions.release ? (
        <Panel id="decision-panel" title={t("fdy2.homog.batch.decision")} testId="homog-decision">
          {b.status === "held" ? <p className="m-0 text-[14px]">{t("fdy2.homog.batch.heldBody")}</p> : b.soakOk === false ? <p className="m-0 text-[14px]">{t("fdy2.homog.batch.decisionBody")}</p> : null}
          <ErrorLine error={hold.error} />
        </Panel>
      ) : null}
      <div className="flex flex-wrap gap-3" data-testid="homog-actions">
        <Can do="foundry.homog">
          {actions.start ? (
            <Button size="lg" loading={start.isPending} onClick={() => start.mutate({ id: b.id })} data-testid="homog-start">{t("fdy2.homog.batch.start")}</Button>
          ) : null}
          {actions.out ? <Button size="lg" onClick={() => setConfirmOut(true)} data-testid="homog-out">{t("fdy2.homog.batch.out")}</Button> : null}
        </Can>
        <Can do="foundry.homogRelease">
          {actions.release ? (
            needsNote ? (
              <Button size="lg" onClick={() => setDialog("release")} data-testid="homog-release">{t("fdy2.homog.batch.releaseWithReason")}</Button>
            ) : (
              <ReleaseNow id={b.id} onDone={() => done(t("fdy2.homog.batch.released"))} />
            )
          ) : null}
          {actions.hold ? (
            <Button size="lg" variant="secondary" loading={hold.isPending} onClick={() => hold.mutate({ id: b.id })} data-testid="homog-hold">{t("fdy2.homog.batch.hold")}</Button>
          ) : null}
          {actions.void ? <Button size="lg" variant="secondary" onClick={() => setDialog("void")} data-testid="homog-void">{t("fdy2.homog.batch.void")}</Button> : null}
        </Can>
      </div>
      <ErrorLine error={start.error ?? out.error} />
      <AddLineSheet open={dialog === "line"} onClose={() => setDialog(null)} d={d} />
      <ReadingSheet open={dialog === "reading"} onClose={() => setDialog(null)} d={d} />
      <NoteSheet
        open={dialog === "release"}
        onClose={() => setDialog(null)}
        title={t("fdy2.homog.batch.releaseWithReason")}
        submitLabel={t("fdy2.homog.batch.release")}
        testId="homog-release-sheet"
        send={releaseNote}
        batchId={b.id}
      />
      <NoteSheet
        open={dialog === "void"}
        onClose={() => setDialog(null)}
        title={t("fdy2.homog.batch.voidTitle", { number: b.number })}
        hint={t("fdy2.homog.batch.voidHint")}
        submitLabel={t("fdy2.homog.batch.voidConfirm")}
        testId="homog-void-sheet"
        send={voidIt}
        batchId={b.id}
      />
      <Sheet
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title={t("fdy2.homog.batch.out")}
        description={t("fdy2.homog.batch.outConfirm", { number: b.number })}
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setConfirmOut(false)}>{t("common.cancel")}</Button>
            <Button size="lg" loading={out.isPending} data-testid="homog-out-confirm" onClick={() => out.mutate({ id: b.id }, { onSettled: () => setConfirmOut(false) })}>{t("fdy2.homog.batch.out")}</Button>
          </>
        }
      >
        <span />
      </Sheet>
    </>
  );
}

function ReleaseNow({ id, onDone }: { id: string; onDone(): void }) {
  const { t } = useT();
  const release = useMutation(trpc.foundry.homog.release.mutationOptions({ onSuccess: onDone }));
  return (
    <>
      <Button size="lg" loading={release.isPending} onClick={() => release.mutate({ id })} data-testid="homog-release">{t("fdy2.homog.batch.release")}</Button>
      <ErrorLine error={release.error} className="w-full" />
    </>
  );
}

// --- Logs on the batch ---------------------------------------------------------------------------------------------

function LinesPanel({ d, editable, onAdd }: { d: Detail; editable: boolean; onAdd(): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const invalidate = useHomogInvalidate();
  const remove = useMutation(trpc.foundry.homog.removeLine.mutationOptions({ onSuccess: () => { toast.success(t("fdy2.homog.batch.lineRemoved")); invalidate(); } }));
  return (
    <Panel
      id="lines-panel"
      title={t("fdy2.homog.batch.lines")}
      testId="homog-lines"
      actions={
        editable ? (
          <Can do="foundry.homog">
            <Button size="sm" variant="secondary" onClick={onAdd} data-testid="homog-add-line">{t("fdy2.homog.batch.addLine")}</Button>
          </Can>
        ) : undefined
      }
    >
      {d.lines.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.homog.batch.noLines")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {d.lines.map((l) => (
            <li key={l.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5" data-cast={l.castNumber}>
              <span className="font-mono text-[16px] font-bold">{l.castNumber}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{t("fdy2.homog.pcsKg", { pcs: l.pcs, kg: kgGrouped1(fmt, l.kgG) })}</span>
                {editable ? (
                  <Can do="foundry.homog">
                    <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate({ lineId: l.id })} data-testid="homog-remove-line">{t("fdy2.homog.batch.remove")}</Button>
                  </Can>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorLine error={remove.error} />
    </Panel>
  );
}

function AddLineSheet({ open, onClose, d }: { open: boolean; onClose(): void; d: Detail }) {
  const { t } = useT();
  const fmt = useFmt();
  const invalidate = useHomogInvalidate();
  const casts = useQuery({ ...trpc.foundry.casts.list.queryOptions({ limit: 200, offset: 0 }), meta: INLINE_ERROR_META, enabled: open });
  const options = (casts.data?.items ?? []).filter((c) => c.alloy === d.batch.alloy && c.status !== "cancelled" && !d.lines.some((l) => l.castId === c.id));
  const [castId, setCastId] = useState("");
  const [pcs, setPcs] = useState("");
  const [kg, setKg] = useState("");
  const [tried, setTried] = useState(false);
  const add = useMutation(
    trpc.foundry.homog.addLine.mutationOptions({
      onSuccess: () => {
        toast.success(t("fdy2.homog.batch.lineAdded"));
        invalidate();
        close();
      },
    }),
  );
  const close = () => {
    setTried(false);
    setCastId("");
    setPcs("");
    setKg("");
    add.reset();
    onClose();
  };
  const pcsN = pcsOf(pcs);
  const kgG = kgToG(kg);
  const issue = !castId ? "cast" : pcsN === null ? "pcs" : kgG === null || kgG < 1 ? "kg" : null;
  const err = (k: "cast" | "pcs" | "kg") => (tried && issue === k ? t(`fdy2.homog.batch.lineErr.${k}`) : undefined);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : close())}
      title={t("fdy2.homog.batch.addLine")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={add.isPending}
            data-testid="homog-line-save"
            onClick={() => {
              setTried(true);
              if (issue || pcsN === null || kgG === null) return;
              add.mutate({ batchId: d.batch.id, castId, pcs: pcsN, kgG });
            }}
          >
            {t("fdy2.homog.batch.addLine")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {casts.data && options.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.homog.batch.castNone", { alloy: d.batch.alloy })}</p> : null}
        <Field label={t("fdy2.homog.batch.cast")} error={err("cast")}>
          <FieldSelect value={castId} onChange={(e) => setCastId(e.currentTarget.value)} data-testid="homog-line-cast">
            <option value="">{t("fdy2.homog.batch.castPick")}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>{t("fdy2.homog.batch.castOption", { number: c.number ?? c.id, kg: kgGrouped1(fmt, c.billetsOnHandG) })}</option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("fdy2.homog.batch.pcs")} error={err("pcs")}>
          <NumberInput value={pcs} onValueChange={setPcs} data-testid="homog-line-pcs" />
        </Field>
        <Field label={t("fdy2.homog.batch.weightLabel")} error={err("kg")}>
          <PlantInput spec={MASS_KG} value={kg} onValueChange={setKg} data-testid="homog-line-kg" />
        </Field>
        <ErrorLine error={add.error} />
      </div>
    </Sheet>
  );
}

// --- Soak and readings -----------------------------------------------------------------------------------------------

function SoakPanel({ d, onAdd }: { d: Detail; onAdd: (() => void) | null }) {
  const { t } = useT();
  const fmt = useFmt();
  const b = d.batch;
  const soak = d.soak;
  const readings = d.readings.map((r) => ({ at: new Date(r.at).getTime(), tempCX10: r.tempX10 }));
  const verdict = soak?.verdict as HomogVerdict | undefined;
  return (
    <Panel
      id="soak-panel"
      title={t("fdy2.homog.batch.soakTitle")}
      testId="homog-soak-panel"
      actions={
        <span className="flex items-center gap-2">
          {verdict ? <Chip tone={HOMOG_VERDICT_TONE[verdict]} truncate={false}>{t(`fdy2.homog.verdict.${verdict}`)}</Chip> : null}
          {onAdd ? (
            <Can do="foundry.homog">
              <Button size="sm" onClick={onAdd} data-testid="homog-add-reading">{t("fdy2.homog.batch.addReading")}</Button>
            </Can>
          ) : null}
        </span>
      }
    >
      <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label={t("fdy2.homog.batch.soakNeeded")} value={t("fdy2.homog.batch.minutes", { min: b.soakMin })} />
        <Figure label={t("fdy2.homog.batch.inBand")} value={t("fdy2.homog.batch.minutes", { min: soak?.inBandMin ?? 0 })} strong />
        <Figure label={t("fdy2.homog.batch.unknown")} value={t("fdy2.homog.batch.minutes", { min: soak?.unknownMin ?? 0 })} />
        <Figure label={t("fdy2.homog.batch.above")} value={t("fdy2.homog.batch.minutes", { min: soak?.aboveBandMin ?? 0 })} />
        <Figure label={t("fdy2.homog.batch.minMax")} value={soak && soak.minX10 !== null ? `${x10Text(soak.minX10)} / ${x10Text(soak.maxX10)}` : "-"} />
      </dl>
      <TempSpark readings={readings} band={recipeBand(b)} height={88} />
      {d.readings.length > 0 ? (
        <table className="w-full text-left text-[14px]" data-testid="homog-readings">
          <caption className="sr-only">{t("fdy2.homog.batch.readings")}</caption>
          <thead>
            <tr className="text-[13px] text-muted-foreground">
              <th scope="col" className="py-1 font-normal">{t("fdy2.homog.batch.readingAt")}</th>
              <th scope="col" className="py-1 text-right font-normal">{t("fdy2.homog.batch.readingTemp")}</th>
            </tr>
          </thead>
          <tbody>
            {[...d.readings].reverse().slice(0, 30).map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1.5">{whenText(fmt, r.at)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{x10Text(r.tempX10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Panel>
  );
}

function ReadingSheet({ open, onClose, d }: { open: boolean; onClose(): void; d: Detail }) {
  const { t } = useT();
  const invalidate = useHomogInvalidate();
  const [temp, setTemp] = useState("");
  const [tried, setTried] = useState(false);
  const save = useMutation(
    trpc.foundry.homog.reading.mutationOptions({
      onSuccess: () => {
        toast.success(t("fdy2.homog.batch.readingSaved"));
        invalidate();
        close();
      },
    }),
  );
  const close = () => {
    setTried(false);
    setTemp("");
    save.reset();
    onClose();
  };
  const x10 = readingX10(temp);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : close())}
      title={t("fdy2.homog.batch.addReading")}
      description={t("fdy2.homog.recipe", { temp: x10Text(d.batch.targetTempX10), tol: x10Text(d.batch.toleranceX10), min: d.batch.soakMin })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={save.isPending}
            data-testid="homog-reading-save"
            onClick={() => {
              setTried(true);
              if (x10 === null) return;
              save.mutate({ batchId: d.batch.id, tempX10: x10 });
            }}
          >
            {t("fdy2.homog.batch.addReading")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("fdy2.homog.batch.readingTemp")} error={tried && x10 === null ? t("fdy2.homog.batch.readingInvalid") : undefined}>
          <NumberInput value={temp} onValueChange={setTemp} className="h-14 text-[22px]" data-testid="homog-reading-temp" />
        </Field>
        <ErrorLine error={save.error} />
      </div>
    </Sheet>
  );
}

// --- Release with a reason, void ---------------------------------------------------------------------------------

type NoteMutation = { mutate(v: { id: string; note: string }): unknown; isPending: boolean; error: unknown; reset(): void };

/** A sheet with one required reason (3 letters or more): release of a failed or held batch, and void. */
function NoteSheet({
  open,
  onClose,
  title,
  hint,
  submitLabel,
  testId,
  send,
  batchId,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  hint?: string;
  submitLabel: string;
  testId: string;
  send: NoteMutation;
  batchId: string;
}): ReactNode {
  const { t } = useT();
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const close = () => {
    setTried(false);
    setNote("");
    send.reset();
    onClose();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : close())}
      title={title}
      description={hint}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={send.isPending}
            data-testid={`${testId}-save`}
            onClick={() => {
              setTried(true);
              if (!noteOk(note)) return;
              send.mutate({ id: batchId, note: note.trim() });
            }}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1" data-testid={testId}>
        <Field label={t("fdy2.homog.batch.reason")} hint={t("fdy2.homog.batch.reasonHint")} error={tried && !noteOk(note) ? t("fdy2.homog.batch.reasonRequired") : undefined}>
          <FieldTextArea value={note} maxLength={300} onChange={(e) => setNote(e.currentTarget.value)} data-testid={`${testId}-note`} />
        </Field>
        <ErrorLine error={send.error} />
      </div>
    </Sheet>
  );
}
