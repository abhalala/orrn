import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Stepper } from "@orrn/ui/components/stepper";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { kgFromG } from "@/features/press/model";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { latestVerdict } from "./cast-view";
import { gateSentences, gateStep } from "./errors";
import { blankForm, formFromMelt, saveInputOf, sameForm, STEPS, type FormIssue, type MeltForm, type SavedMelt, type Step } from "./melt-form";
import { todayIn } from "./melt-times";
import { Balance, ChargeStep, ChemicalsStep, OutputStep, TimesStep } from "./melt-steps";
import { MeltSheet } from "./melt-sheet";
import { SpectroPanel } from "./spectro-panel";
import { verdictTone } from "./model";
import { ErrorLine, LoadFailed, Note, Panel, useTimeZone } from "./ui";

type CastData = inferRouterOutputs<AppRouter>["foundry"]["casts"]["get"];
type DraftView = inferRouterOutputs<AppRouter>["foundry"]["melts"]["save"];

/**
 * `/casts/$id/melt/$meltId` (FP-FD-03..08, 10..13): the melt stepper. `$meltId` is a saved draft, a
 * locked melt (read-only sheet, with the correction request) or `new` (the first save makes the
 * draft). A draft posts nothing; the server alone stores the burn, yield and verdict, and the lock
 * gates it returns are the only reasons the Lock button waits.
 */
export function MeltScreen({ castId, meltId, step, onStep }: { castId: string; meltId: string; step: Step; onStep(step: Step): void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const castQuery = useQuery({ ...trpc.foundry.casts.get.queryOptions({ id: castId }), meta: INLINE_ERROR_META });
  const back = { to: `/casts/${castId}`, label: t("foundry.cast.back") };
  const data = castQuery.data;
  if (showsQueryError(castQuery)) {
    return (
      <>
        <PageHeader title={t("foundry.melt.title")} back={back} />
        <LoadFailed title={t("foundry.cast.loadFailed")} onRetry={() => void castQuery.refetch()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title={t("foundry.melt.title")} back={back} />
        <Skeleton className="h-48 rounded-card" />
      </>
    );
  }
  const melt = meltId === "new" ? null : (data.melts.find((m) => m.id === meltId) ?? undefined);
  if (melt === undefined) {
    return (
      <>
        <PageHeader title={t("foundry.melt.title")} back={back} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("foundry.melt.notFound")} />
        </div>
      </>
    );
  }
  const editable = (melt === null || melt.status === "draft") && data.cast.status === "open" && can(me, "melt.enter");
  if (!editable && melt === null) {
    return (
      <>
        <PageHeader title={t("foundry.melt.new")} back={back} />
        <Note tone="amber">{data.cast.status === "open" ? t("foundry.common.notAllowed") : t("foundry.melt.castNotOpen", { number: data.cast.number })}</Note>
      </>
    );
  }
  if (!editable && melt) return <MeltSheet data={data} melt={melt} />;
  return <MeltEditor key={melt?.id ?? "new"} data={data} melt={melt ?? null} step={step} onStep={onStep} />;
}

function MeltEditor({ data, melt, step, onStep }: { data: CastData; melt: CastData["melts"][number] | null; step: Step; onStep(step: Step): void }) {
  const { t } = useT();
  const timeZone = useTimeZone();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const castId = data.cast.id;
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META });
  const furnaces = useQuery({ ...trpc.foundry.furnaces.list.queryOptions(), meta: INLINE_ERROR_META });
  const lots = useQuery({ ...trpc.foundry.lots.available.queryOptions(), meta: INLINE_ERROR_META });
  const streams = useQuery({ ...trpc.foundry.returnStreams.list.queryOptions(), meta: INLINE_ERROR_META });
  const store = useQuery({ ...trpc.store.items.list.queryOptions(), meta: INLINE_ERROR_META });
  const activeFurnaces = (furnaces.data?.items ?? []).filter((f) => f.status === "active");
  const [form, setForm] = useState<MeltForm>(() => {
    if (melt) return formFromMelt(melt as unknown as SavedMelt, timeZone, todayIn(timeZone));
    return blankForm(todayIn(timeZone));
  });
  // The single active furnace is the default of a new melt (once the list is in).
  const defaulted = useRef(melt !== null);
  if (!defaulted.current && furnaces.data) {
    defaulted.current = true;
    if (activeFurnaces.length === 1 && form.furnaceId === "") setForm((f) => ({ ...f, furnaceId: activeFurnaces[0]!.id }));
  }
  const saved = useRef<MeltForm>(form);
  const meltIdRef = useRef<string | null>(melt?.id ?? null);
  // Mirrors the ref for what renders (the gate list reads the saved draft).
  const [savedMeltId, setSavedMeltId] = useState<string | null>(melt?.id ?? null);
  const seqRef = useRef<number | undefined>(melt?.serverSeq);
  const firstRequest = useRef(crypto.randomUUID());
  const lockRequest = useRef(crypto.randomUUID());
  const [issue, setIssue] = useState<FormIssue | null>(null);
  const [view, setView] = useState<DraftView | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const dirty = !sameForm(form, saved.current);

  const saveMut = useMutation(trpc.foundry.melts.save.mutationOptions());
  const lockMut = useMutation(trpc.foundry.melts.lock.mutationOptions());
  // The gates always come from the server's preview of the SAVED draft; a spectro result, a save or a
  // discard refreshes it (they invalidate `foundry.melts`).
  const preview = useQuery({
    ...trpc.foundry.melts.preview.queryOptions({ meltId: savedMeltId ?? "" }),
    enabled: savedMeltId !== null,
    meta: INLINE_ERROR_META,
  });
  // Every code the server returns holds the lock, even one this build has no sentence for (it shows the generic line).
  const gates: readonly string[] = (preview.data ?? view)?.gates ?? [];

  const castAlloy = data.cast.alloy;
  const alloyList = (alloys.data?.items ?? []).filter((a) => a.status === "active");
  const meltAlloy = alloys.data?.items.find((a) => a.id === (form.alloyId || data.cast.alloyId)) ?? alloys.data?.items.find((a) => a.code === castAlloy);
  const capacityG = activeFurnaces.find((f) => f.id === form.furnaceId)?.capacityG ?? null;
  const patch = (next: Partial<MeltForm>) => {
    setIssue(null);
    setForm((f) => ({ ...f, ...next }));
  };

  /** Saves the form; null when something on it cannot be sent or the server refused. */
  const save = async (): Promise<DraftView | null> => {
    const r = saveInputOf(form, {
      castId,
      ...(meltIdRef.current ? { meltId: meltIdRef.current } : { clientRequestId: firstRequest.current }),
      ...(seqRef.current !== undefined ? { expectedServerSeq: seqRef.current } : {}),
      timeZone,
    });
    if (!r.ok) {
      setIssue(r.issue);
      onStep(r.issue.step);
      return null;
    }
    try {
      const v = await saveMut.mutateAsync(r.input as never);
      saved.current = form;
      seqRef.current = v.serverSeq;
      const wasNew = meltIdRef.current === null;
      meltIdRef.current = v.id;
      setSavedMeltId(v.id);
      setView(v);
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.melts.pathKey() });
      if (wasNew) void navigate({ to: "/casts/$id/melt/$meltId", params: { id: castId, meltId: v.id }, search: step === "times" ? {} : { step }, replace: true });
      return v;
    } catch {
      return null;
    }
  };

  const index = STEPS.indexOf(step);
  const last = index === STEPS.length - 1;
  const go = (to: Step) => onStep(to);
  const next = async () => {
    if (dirty || meltIdRef.current === null) {
      if (!(await save())) return;
    }
    go(STEPS[Math.min(index + 1, STEPS.length - 1)]!);
  };
  const lock = async () => {
    const v = dirty || meltIdRef.current === null ? await save() : ((await preview.refetch()).data ?? view ?? null);
    if (!v) return;
    if (v.gates.length > 0) return;
    try {
      const res = await lockMut.mutateAsync({ meltId: v.id, clientMutationId: lockRequest.current });
      toast.success(t("foundry.melt.locked", { seq: res.seq, number: res.castNumber }));
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
      void navigate({ to: "/casts/$id", params: { id: castId } });
    } catch {
      lockRequest.current = crypto.randomUUID();
    }
  };

  const savedMelt = data.melts.find((m) => m.id === savedMeltId) ?? melt ?? null;
  const verdict = savedMelt ? latestVerdict(savedMelt.spectro) : null;
  const seq = savedMelt?.seq;
  const stepNames = STEPS.map((s) => t(`foundry.melt.steps.${s}`));
  const header = (
    <PageHeader
      title={seq ? t("foundry.melt.titleOf", { n: seq, number: data.cast.number }) : t("foundry.melt.newOf", { number: data.cast.number })}
      subtitle={t("foundry.melt.draftHint")}
      back={{ to: `/casts/${castId}`, label: t("foundry.cast.back") }}
      actions={
        <div className="flex items-center gap-2">
          <Chip tone="amber" truncate={false}>{t("foundry.melt.status.draft")}</Chip>
          {savedMeltId ? (
            <Button variant="ghost" onClick={() => setDiscarding(true)} data-testid="discard-draft">
              {t("foundry.melt.discard.button")}
            </Button>
          ) : null}
        </div>
      }
    />
  );

  if (showsQueryError(lots) || showsQueryError(alloys) || showsQueryError(furnaces)) {
    return (
      <>
        {header}
        <LoadFailed title={t("foundry.melt.loadFailed")} onRetry={() => { void lots.refetch(); void alloys.refetch(); void furnaces.refetch(); }} />
      </>
    );
  }

  const common = { form, patch, issue };
  return (
    <>
      {header}
      {savedMelt?.correctsMeltId ? (
        <Note testId="corrects-note">{t("foundry.melt.correctsNote", { n: data.melts.find((m) => m.id === savedMelt.correctsMeltId)?.seq ?? "" })}</Note>
      ) : null}
      <Stepper steps={stepNames} current={index} />
      <div className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5" data-testid={`melt-step-${step}`}>
        <h2 className="m-0 text-[18px] font-semibold">{stepNames[index]}</h2>
        {step === "times" ? (
          <TimesStep {...common} furnaces={activeFurnaces} alloys={alloyList} castAlloy={castAlloy} timeZone={timeZone} />
        ) : step === "charge" ? (
          <>
            <ChargeStep {...common} lots={(lots.data?.lots ?? []) as never} streams={(streams.data?.items ?? []) as never} capacityG={capacityG} />
            <Balance form={form} capacityG={capacityG} />
          </>
        ) : step === "chemicals" ? (
          <ChemicalsStep {...common} storeItems={(store.data?.items ?? []) as never} />
        ) : step === "output" ? (
          <OutputStep {...common} streams={(streams.data?.items ?? []) as never} capacityG={capacityG} />
        ) : (
          <div className="flex flex-col gap-5">
            <SpectroPanel
              meltId={savedMeltId}
              results={savedMelt?.spectro ?? []}
              limits={meltAlloy?.limits ?? []}
              alloyCode={meltAlloy?.code ?? castAlloy}
              draft
            />
            {verdict !== "pass" ? (
              <Field label={t("foundry.melt.spectroReason")} hint={t("foundry.melt.spectroReasonHint")}>
                <FieldTextArea value={form.spectroReason} maxLength={500} onChange={(e) => patch({ spectroReason: e.currentTarget.value })} data-testid="melt-spectro-reason" />
              </Field>
            ) : (
              <p className="m-0 flex items-center gap-2 text-[14px]"><Chip tone={verdictTone(verdict)}>{t("foundry.spectro.verdict.pass")}</Chip></p>
            )}
            <Field label={t("foundry.melt.notes")}>
              <FieldTextArea value={form.notes} maxLength={500} onChange={(e) => patch({ notes: e.currentTarget.value })} />
            </Field>
            <Balance form={form} capacityG={capacityG} />
            <GateList gates={gates} dirty={dirty} pending={preview.isFetching} onGo={go} />
            <Readings meltId={savedMeltId} />
          </div>
        )}
      </div>
      <ErrorLine error={saveMut.error ?? lockMut.error} />
      {issue ? <Note tone="red" testId="form-issue">{t(`foundry.melt.issue.${issue.code}`)}</Note> : null}
      <FormActions className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+0.75rem)]">
        {index > 0 ? (
          <Button variant="secondary" size="lg" onClick={() => go(STEPS[index - 1]!)} data-testid="melt-back">
            {t("common.back")}
          </Button>
        ) : null}
        <Button variant="secondary" size="lg" loading={saveMut.isPending} disabled={lockMut.isPending} onClick={() => void save().then((v) => v && toast.success(t("foundry.melt.draftSaved")))} data-testid="melt-save">
          {t("foundry.melt.saveDraft")}
        </Button>
        {!last ? (
          <Button size="lg" loading={saveMut.isPending} onClick={() => void next()} data-testid="melt-next">
            {t("foundry.melt.saveNext")}
          </Button>
        ) : (
          <Can do="melt.enter">
            <Button size="lg" loading={saveMut.isPending || lockMut.isPending} disabled={gates.length > 0 && !dirty} onClick={() => void lock()} data-testid="melt-lock">
              {t("foundry.melt.lock")}
            </Button>
          </Can>
        )}
      </FormActions>
      {savedMeltId ? <DiscardSheet open={discarding} onClose={() => setDiscarding(false)} meltId={savedMeltId} castId={castId} /> : null}
    </>
  );
}

/** What still stops the lock, each in the person's language with a jump to the step that fixes it. */
function GateList({ gates, dirty, pending, onGo }: { gates: readonly string[]; dirty: boolean; pending: boolean; onGo(step: Step): void }) {
  const { t } = useT();
  if (dirty) return <Note>{t("foundry.melt.gates.unsaved")}</Note>;
  if (pending) return <Note>{t("common.loading")}</Note>;
  if (gates.length === 0) return <Note tone="green" testId="gates-ready">{t("foundry.melt.gates.ready")}</Note>;
  const sentences = gateSentences(t, gates);
  return (
    <div className="flex flex-col gap-2" data-testid="gates">
      <p className="m-0 text-[15px] font-semibold">{t("foundry.melt.gates.title")}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {gates.map((g, i) => (
          <li key={g} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-tone-amber-tint px-4 py-2 text-[14px] text-tone-amber-ink" data-gate={g}>
            <span className="min-w-0 break-words">{sentences[i]}</span>
            {gateStep(g) ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => onGo(gateStep(g)!)}>
                {t("foundry.melt.gates.fix")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Furnace readings of the melt; the simulator button exists only in a dev build with FOUNDRY_SIMULATOR on. */
function Readings({ meltId }: { meltId: string | null }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const q = useQuery({ ...trpc.foundry.readings.list.queryOptions({ meltId: meltId ?? "" }), enabled: meltId !== null, meta: INLINE_ERROR_META });
  const sim = useMutation(
    trpc.foundry.readings.simulate.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.foundry.readings.pathKey() }),
    }),
  );
  if (!meltId || !q.data) return null;
  const showSim = import.meta.env.DEV && q.data.simulator;
  if (q.data.items.length === 0 && !showSim) return null;
  return (
    <Panel id="readings" title={t("foundry.melt.readings.title")} testId="readings">
      {q.data.items.length > 0 ? (
        <p className="m-0 font-mono text-[14px] tabular-nums" data-testid="readings-list">
          {q.data.items.map((r) => (r.valueX10 / 10).toFixed(1)).join(", ")} {t("foundry.melt.readings.unit")}
        </p>
      ) : (
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.melt.readings.none")}</p>
      )}
      {showSim ? (
        <div>
          <Button type="button" variant="secondary" loading={sim.isPending} onClick={() => sim.mutate({ meltId })} data-testid="foundry-simulator">
            {t("foundry.melt.readings.simulate")}
          </Button>
          <ErrorLine error={sim.error} className="mt-2" />
        </div>
      ) : null}
    </Panel>
  );
}

function DiscardSheet({ open, onClose, meltId, castId }: { open: boolean; onClose(): void; meltId: string; castId: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const discard = useMutation(
    trpc.foundry.melts.discard.mutationOptions({
      onSuccess: () => {
        toast.success(t("foundry.melt.discard.done"));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
        void navigate({ to: "/casts/$id", params: { id: castId } });
      },
    }),
  );
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("foundry.melt.discard.title")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="lg" variant="danger" loading={discard.isPending} data-testid="discard-confirm" onClick={() => discard.mutate({ meltId, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
            {t("foundry.melt.discard.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Note>{t("foundry.melt.discard.body")}</Note>
        <Field label={t("foundry.melt.discard.reason")}>
          <FieldTextArea value={reason} maxLength={500} onChange={(e) => setReason(e.currentTarget.value)} />
        </Field>
        <ErrorLine error={discard.error} />
      </div>
    </Sheet>
  );
}

