import { type SpectroLimit, type SpectroVerdict } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock } from "@/components/ui/state";
import { Sheet } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { replayKey, sendOnce, type ReplayAttempt } from "@/lib/replay-key";
import { writeFailureKind } from "@/lib/request-timeout";
import { useFormat } from "@/lib/use-format";
import { queryClient, trpc } from "@/utils/trpc";

import { foundryError, gateSentences, gateStep } from "./errors";
import { lockState, verdictTone } from "./foundry-model";
import { blankForm, figuresOf, formFromMelt, sameForm, saveInputOf, type FormIssue, type MeltForm, type SavedMelt, type Step } from "./melt-form";
import { todayIn } from "./melt-times";
import { Accordion, Balance, ChargeSection, OutputSection, TimesSection, type AlloyOpt, type FurnaceOpt, type Lot, type Stream } from "./melt-sections";
import { SpectroPanel } from "./spectro-panel";
import type { CastData, DraftView, MeltRow } from "./types";
import { ErrorLine, Note, kgOf } from "./ui";

type Part = "times" | "charge" | "output" | "spectro";
const VERDICT_KEY = { pass: "foundry.spectro.verdict.pass", fail: "foundry.spectro.verdict.fail", incomplete: "foundry.spectro.verdict.incomplete" } as const;

/** A save step of the shared form maps to the part of the phone sheet that holds it (chemicals and LDO stay as saved). */
const partOf = (step: Step): Part => (step === "chemicals" ? "charge" : step);

/** The latest live spectro verdict of a melt. */
function verdictOf(spectro: readonly { verdict: string | null; voidedAt: unknown }[]): SpectroVerdict | null {
  const live = spectro.filter((s) => !s.voidedAt);
  return (live[live.length - 1]?.verdict as SpectroVerdict | null | undefined) ?? null;
}

/**
 * The melt sheet on a phone: a draft that posts nothing until Lock. Four parts (times, charge, logs and
 * dross, spectro) open one at a time on tap, with the running balance on top and Save draft and Lock in a
 * bar that stays put. The server alone stores the burn, yield and verdict; the lock gates it returns are the
 * only reasons Lock waits, said in the person's language. Saves and the lock carry replay keys.
 */
export function MeltEditor({ data, melt }: { data: CastData; melt: MeltRow | null }) {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { zone: timeZone } = useFormat();
  const castId = data.cast.id;
  const alloys = useQuery(trpc.foundry.alloys.list.queryOptions());
  const furnaces = useQuery(trpc.foundry.furnaces.list.queryOptions());
  const lots = useQuery(trpc.foundry.lots.available.queryOptions());
  const streams = useQuery(trpc.foundry.returnStreams.list.queryOptions());
  const activeFurnaces = (furnaces.data?.items ?? []).filter((f) => f.status === "active");
  const [form, setForm] = useState<MeltForm>(() => (melt ? formFromMelt(melt as unknown as SavedMelt, timeZone, todayIn(timeZone)) : blankForm(todayIn(timeZone))));
  // The single active furnace is the default of a new melt, once the list is in.
  const defaulted = useRef(melt !== null);
  if (!defaulted.current && furnaces.data) {
    defaulted.current = true;
    if (activeFurnaces.length === 1 && form.furnaceId === "") setForm((f) => ({ ...f, furnaceId: activeFurnaces[0]!.id }));
  }
  const saved = useRef<MeltForm>(form);
  const meltIdRef = useRef<string | null>(melt?.id ?? null);
  const [savedMeltId, setSavedMeltId] = useState<string | null>(melt?.id ?? null);
  const seqRef = useRef<number | undefined>(melt?.serverSeq);
  const firstAttempt = useRef<ReplayAttempt>(null);
  const lockAttempt = useRef<ReplayAttempt>(null);
  const [issue, setIssue] = useState<FormIssue | null>(null);
  const [view, setView] = useState<DraftView | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [openParts, setOpenParts] = useState<ReadonlySet<Part>>(new Set<Part>(["times"]));
  const [discarding, setDiscarding] = useState(false);
  const dirty = !sameForm(form, saved.current);

  const saveMut = useMutation(trpc.foundry.melts.save.mutationOptions());
  const lockMut = useMutation(trpc.foundry.melts.lock.mutationOptions());
  // The gates always come from the server's preview of the SAVED draft; a spectro result, a save or a discard refreshes it.
  const preview = useQuery({ ...trpc.foundry.melts.preview.queryOptions({ meltId: savedMeltId ?? "" }), enabled: savedMeltId !== null });
  const current = preview.data ?? view;
  // Every code the server returns holds the lock, even one this build has no sentence for.
  const gates: readonly string[] = current?.gates ?? [];
  const needsNewSample = current?.spectroNeedsNewSample ?? false;

  const castAlloy = data.cast.alloy;
  const alloyList = (alloys.data?.items ?? []).filter((a) => a.status === "active");
  const meltAlloy = alloys.data?.items.find((a) => a.id === (form.alloyId || data.cast.alloyId)) ?? alloys.data?.items.find((a) => a.code === castAlloy);
  const capacityG = activeFurnaces.find((f) => f.id === form.furnaceId)?.capacityG ?? null;
  const fig = figuresOf(form, capacityG);
  const savedMelt = data.melts.find((m) => m.id === savedMeltId) ?? melt ?? null;
  const verdict = savedMelt ? verdictOf(savedMelt.spectro) : null;
  const seq = savedMelt?.seq;

  const patch = (next: Partial<MeltForm>) => {
    setIssue(null);
    setForm((f) => ({ ...f, ...next }));
  };
  const show = (part: Part) => setOpenParts((s) => new Set([...s, part]));
  const toggle = (part: Part) =>
    setOpenParts((s) => {
      const n = new Set(s);
      if (n.has(part)) n.delete(part);
      else n.add(part);
      return n;
    });

  const failed = (error: unknown) => {
    feedback.error();
    setProblem(error);
    announce(foundryError(t, error));
  };

  /** After an answer that never came: read the melt again and take its sequence, so saving the same sheet again is not refused as stale. */
  const resync = async () => {
    const fresh = await queryClient.fetchQuery({ ...trpc.foundry.casts.get.queryOptions({ id: castId }), staleTime: 0 }).catch(() => null);
    const m = fresh?.melts.find((x) => x.id === meltIdRef.current);
    if (m) seqRef.current = m.serverSeq;
  };

  /** Saves the form; null when something on it cannot be sent or the server refused. */
  const save = async (): Promise<DraftView | null> => {
    const r = saveInputOf(form, {
      castId,
      ...(meltIdRef.current ? { meltId: meltIdRef.current } : {}),
      ...(seqRef.current !== undefined ? { expectedServerSeq: seqRef.current } : {}),
      timeZone,
    });
    if (!r.ok) {
      setIssue(r.issue);
      show(partOf(r.issue.step));
      feedback.error();
      announce(t(`foundry.melt.issue.${r.issue.code}`));
      return null;
    }
    setProblem(null);
    try {
      let v: DraftView;
      if (meltIdRef.current === null) {
        // The first save makes the draft: a resent one carries the same request id, so it never makes two.
        const next = replayKey(firstAttempt.current, r.input, randomId);
        firstAttempt.current = next.attempt;
        v = await sendOnce((clientRequestId) => saveMut.mutateAsync({ ...r.input, clientRequestId } as never), next.id);
        firstAttempt.current = null;
      } else {
        // Later saves send the sequence they were made from: a repeat of one that landed is refused as stale, not applied twice.
        v = await saveMut.mutateAsync(r.input as never);
      }
      saved.current = form;
      seqRef.current = v.serverSeq;
      meltIdRef.current = v.id;
      setSavedMeltId(v.id);
      setView(v);
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.melts.pathKey() });
      return v;
    } catch (error) {
      failed(error);
      if (meltIdRef.current !== null && writeFailureKind(error) === "unsure") await resync();
      return null;
    }
  };

  const lock = async () => {
    const v = dirty || meltIdRef.current === null ? await save() : ((await preview.refetch()).data ?? view ?? null);
    if (!v || v.gates.length > 0) {
      if (v) setView(v);
      return;
    }
    setProblem(null);
    try {
      const body = { meltId: v.id };
      const next = replayKey(lockAttempt.current, body, randomId);
      lockAttempt.current = next.attempt;
      const res = await sendOnce((clientRequestId) => lockMut.mutateAsync({ ...body, clientMutationId: clientRequestId }), next.id);
      lockAttempt.current = null;
      feedback.success();
      announce(t("foundry.melt.locked", { seq: res.seq, number: res.castNumber }));
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
      router.back();
    } catch (error) {
      failed(error);
      // An unsure lock may have landed: the melt is read again, and the next tap sends the same request id.
      if (writeFailureKind(error) === "unsure") void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
    }
  };

  const state = lockState({ saved: savedMeltId !== null, dirty, gates, needsNewSample, spectroReason: form.spectroReason, pending: preview.isFetching });
  const sentences = gateSentences(t, gates);
  const busy = saveMut.isPending || lockMut.isPending;

  if (lots.isError && !lots.data) return <ErrorBlock error={lots.error} onRetry={() => void lots.refetch()} retrying={lots.isRefetching} />;

  const timesSummary = form.times.chargingStart || form.times.castingEnd ? `${form.times.chargingStart || "-"} - ${form.times.castingEnd || "-"}` : undefined;
  const common = { form, patch, issue };

  return (
    <View className="flex-1 bg-canvas">
      <Screen className="pb-4">
        <PageHeader
          title={seq ? t("foundry.melt.titleOf", { n: seq, number: data.cast.number }) : t("foundry.melt.newOf", { number: data.cast.number })}
          subtitle={t("foundry.melt.draftHint")}
          right={<Chip tone="amber" label={t("foundry.melt.status.draft")} />}
        />
        {savedMelt?.correctsMeltId ? <Note>{t("foundry.melt.correctsNote", { n: data.melts.find((m) => m.id === savedMelt.correctsMeltId)?.seq ?? "" })}</Note> : null}
        {fig.balance.metalInG > 0 ? <Balance form={form} capacityG={capacityG} /> : null}

        <Accordion title={t("foundry.melt.steps.times")} summary={timesSummary} open={openParts.has("times")} onToggle={() => toggle("times")}>
          <TimesSection {...common} furnaces={activeFurnaces as FurnaceOpt[]} alloys={alloyList as AlloyOpt[]} castAlloy={castAlloy} timeZone={timeZone} />
        </Accordion>
        <Accordion title={t("foundry.melt.charge.title")} summary={fig.balance.metalInG > 0 ? t("foundry.melt.charge.total", { kg: kgOf(fig.balance.metalInG) }) : undefined} open={openParts.has("charge")} onToggle={() => toggle("charge")}>
          <ChargeSection {...common} lots={(lots.data?.lots ?? []) as Lot[]} streams={(streams.data?.items ?? []) as Stream[]} capacityG={capacityG} />
        </Accordion>
        <Accordion title={t("foundry.melt.steps.output")} summary={fig.logsG > 0 ? `${kgOf(fig.logsG)} ${t("units.kg")}` : undefined} open={openParts.has("output")} onToggle={() => toggle("output")}>
          <OutputSection {...common} streams={(streams.data?.items ?? []) as Stream[]} capacityG={capacityG} />
        </Accordion>
        <Accordion title={t("foundry.spectro.title")} summary={verdict ? t(VERDICT_KEY[verdict]) : undefined} open={openParts.has("spectro")} onToggle={() => toggle("spectro")}>
          <SpectroPanel meltId={savedMeltId} results={savedMelt?.spectro ?? []} limits={(meltAlloy?.limits ?? []) as SpectroLimit[]} alloyCode={meltAlloy?.code ?? castAlloy} draft />
          {needsNewSample ? <Note tone="amber">{t("foundry.melt.spectroNeedsSample", { alloy: meltAlloy?.code ?? castAlloy })}</Note> : null}
          {verdict !== "pass" || needsNewSample ? (
            <Field label={t("foundry.melt.spectroReason")} hint={t("foundry.melt.spectroReasonHint")} value={form.spectroReason} onChangeText={(v) => patch({ spectroReason: v })} maxLength={500} multiline />
          ) : (
            <Chip tone={verdictTone(verdict)} label={t("foundry.spectro.verdict.pass")} />
          )}
          <Field label={t("foundry.melt.notes")} value={form.notes} onChangeText={(v) => patch({ notes: v })} maxLength={500} multiline />
        </Accordion>

        <View className="gap-2">
          <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
            {t("foundry.melt.gates.title")}
          </Text>
          {dirty || savedMeltId === null ? (
            <Note>{t("foundry.melt.gates.unsaved")}</Note>
          ) : preview.isFetching ? (
            <Note>{t("common.loading")}</Note>
          ) : gates.length === 0 ? (
            <Note tone="green">{t("foundry.melt.gates.ready")}</Note>
          ) : (
            gates.map((g, i) => {
              const step = gateStep(g);
              return (
                <View key={g} accessibilityLiveRegion="polite" className="flex-row items-center gap-3 rounded-card bg-tone-amber-tint px-4 py-3">
                  <Text className="min-w-0 flex-1 font-sans text-[15px] leading-6 text-tone-amber-ink">{sentences[i]}</Text>
                  {step ? <Button variant="secondary" label={t("foundry.melt.gates.fix")} onPress={() => show(step)} /> : null}
                </View>
              );
            })
          )}
        </View>

        <ErrorLine error={problem} />
        {issue ? <Note tone="red">{t(`foundry.melt.issue.${issue.code}`)}</Note> : null}
        {savedMeltId ? <Button variant="ghost" label={t("foundry.melt.discard.button")} onPress={() => setDiscarding(true)} /> : null}
      </Screen>

      <View className="gap-2 border-t border-hairline bg-canvas px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        <View className="flex-row gap-3">
          <Button
            className="flex-1"
            variant="secondary"
            size="lg"
            label={t("foundry.melt.saveDraft")}
            loading={saveMut.isPending}
            disabled={lockMut.isPending}
            onPress={() => void save().then((v) => v && (feedback.success(), announce(t("foundry.melt.draftSaved"))))}
          />
          <Can do="melt.enter">
            <Button className="flex-1" size="lg" label={t("foundry.melt.lock")} loading={busy || state === "loading"} disabled={state === "gated" || state === "needs_reason"} onPress={() => void lock()} />
          </Can>
        </View>
      </View>

      {savedMeltId ? <DiscardSheet visible={discarding} onClose={() => setDiscarding(false)} meltId={savedMeltId} /> : null}
    </View>
  );
}

/** Discard a draft: nothing was posted, so nothing is reversed. A second discard is refused by the server (only a draft can be discarded). */
function DiscardSheet({ visible, onClose, meltId }: { visible: boolean; onClose: () => void; meltId: string }) {
  const { t } = useT();
  const router = useRouter();
  const discard = useMutation(trpc.foundry.melts.discard.mutationOptions());
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<unknown>(null);

  const confirm = async () => {
    setProblem(null);
    try {
      await discard.mutateAsync({ meltId, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      feedback.success();
      announce(t("foundry.melt.discard.done"));
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
      onClose();
      router.back();
    } catch (error) {
      feedback.error();
      setProblem(error);
      announce(foundryError(t, error));
      if (writeFailureKind(error) === "unsure") void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("foundry.melt.discard.title")}>
      <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("foundry.melt.discard.body")}</Text>
      <Field label={t("foundry.melt.discard.reason")} value={reason} onChangeText={setReason} maxLength={500} />
      <ErrorLine error={problem} />
      <Button variant="danger" size="lg" label={t("foundry.melt.discard.confirm")} loading={discard.isPending} onPress={() => void confirm()} />
    </Sheet>
  );
}
