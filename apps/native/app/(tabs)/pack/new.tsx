import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { BundlesStep } from "@/features/pack/bundles-step";
import { DieStep } from "@/features/pack/die-step";
import { DRAFT_VERSION, type PackDraft } from "@/features/pack/draft-store";
import { canLeaveDefaults, draftOwner, type PickedDie } from "@/features/pack/pack-form";
import {
  activeYards,
  DEFAULT_SOURCE,
  lengthFieldsToMm,
  lengthToFields,
  receiptPayload,
  type DraftBundle,
  type DraftReject,
  type LengthFields,
  type PackSource,
} from "@/features/pack/pack-math";
import { newSessionKey, packSaveText, validSessionKey, withRequestKey } from "@/features/pack/pack-submit";
import { partyRange } from "@/features/pack/party";
import { ReviewStep, type SaveProblem } from "@/features/pack/review-step";
import { useSourceGate } from "@/features/pack/source-panel";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { clearPackDraft, readPackDraft, writePackDraft } from "@/lib/pack-draft-file";
import { randomId } from "@/lib/random-id";
import { useLengthUnit } from "@/utils/length";
import { useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

const BLANK_LENGTH: LengthFields = { mm: "", feet: "", inches: "" };
const STEPS = ["pack.new.steps.die", "pack.new.steps.bundles", "pack.new.steps.review"] as const;

type Saved = { groupId: string; code: string; bundles: { serial: string; partyNo: string | null }[]; replayed: boolean };

export default function NewPackSessionScreen() {
  const { t } = useT();
  const router = useRouter();
  const me = useMe().data;
  const length = useLengthUnit();
  const unit = length.unit;
  const owner = draftOwner(me?.user?.id, me?.company?.id);

  const [step, setStep] = useState(0);
  const [die, setDie] = useState<PickedDie | null>(null);
  const [source, setSource] = useState<PackSource>(DEFAULT_SOURCE);
  const [lengthFields, setLengthFields] = useState<LengthFields>(BLANK_LENGTH);
  const [po, setPo] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<DraftBundle[]>([]);
  const [rejects, setRejects] = useState<DraftReject[]>([]);
  const [tried, setTried] = useState(false);
  // This session's nonce for the request id (BACKLOG 50): a Save sent again with the same bundles carries the same id.
  const [sessionKey, setSessionKey] = useState(() => newSessionKey(randomId));

  // The unsaved draft on the phone: offered back once, then kept in step with the screen.
  const [offered, setOffered] = useState<PackDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [done, setDone] = useState<Saved | null>(null);

  const create = useMutation(trpc.bundle.createReceipt.mutationOptions());
  const [problem, setProblem] = useState<SaveProblem | null>(null);

  const locations = useQuery(trpc.stock.locations.list.queryOptions());
  const yards = activeYards(locations.data?.items);
  const yard = yards.find((y) => y.id === locationId) ?? null;
  useEffect(() => {
    if (yards.length === 1 && !locationId) setLocationId(yards[0]!.id);
  }, [yards, locationId]);

  const gate = useSourceGate(die?.id ?? null, source, me?.company?.settings);
  const defaultLengthMm = lengthFieldsToMm(unit, lengthFields);

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    void readPackDraft(owner).then((d) => {
      if (!alive) return;
      setOffered(d);
      setDraftReady(true);
    });
    return () => {
      alive = false;
    };
  }, [owner]);

  useEffect(() => {
    if (!draftReady || offered || done || !owner) return;
    if (!die || bundles.length === 0) {
      void clearPackDraft();
      return;
    }
    void writePackDraft({ version: DRAFT_VERSION, owner, die, unit, lengthFields, po, locationId, bundles, source, rejects, sessionKey, savedAt: Date.now() });
  }, [draftReady, offered, done, owner, die, unit, lengthFields, po, locationId, bundles, source, rejects, sessionKey]);

  const resume = useCallback(
    (d: PackDraft) => {
      // A draft typed in the other unit still holds the same mm; show it in today's unit.
      const mm = lengthFieldsToMm(d.unit, d.lengthFields);
      setDie(d.die);
      setSource(d.source ?? DEFAULT_SOURCE);
      setLengthFields(mm !== null ? lengthToFields(mm, unit) : BLANK_LENGTH);
      setPo(d.po);
      setLocationId(d.locationId);
      setBundles(d.bundles);
      setRejects(d.rejects ?? []);
      if (validSessionKey(d.sessionKey)) setSessionKey(d.sessionKey);
      setOffered(null);
      setStep(mm !== null ? 1 : 0);
    },
    [unit],
  );

  const discard = () => {
    Alert.alert(t("native.pack.discardTitle"), t("native.pack.discardBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("pack.new.discardDraft"),
        style: "destructive",
        onPress: () => {
          void clearPackDraft();
          setOffered(null);
        },
      },
    ]);
  };

  /** A clean screen for the next session, with its own request-id nonce. */
  const startAnother = () => {
    setDone(null);
    setStep(0);
    setDie(null);
    setSource(DEFAULT_SOURCE);
    setLengthFields(BLANK_LENGTH);
    setPo("");
    setBundles([]);
    setRejects([]);
    setTried(false);
    setProblem(null);
    setSessionKey(newSessionKey(randomId));
  };

  const save = async () => {
    if (!die || defaultLengthMm === null || bundles.length === 0) return;
    setProblem(null);
    const payload = receiptPayload({ dieId: die.id, unit, defaults: { lengthMm: defaultLengthMm, po }, locationId: locationId ?? undefined, bundles, source, rejects });
    try {
      const res = await create.mutateAsync(withRequestKey(sessionKey, payload));
      await clearPackDraft();
      feedback.success();
      announce(t("pack.new.saved"));
      void queryClient.invalidateQueries(trpc.bundle.pathFilter());
      void queryClient.invalidateQueries(trpc.dashboard.pathFilter());
      void queryClient.invalidateQueries(trpc.stock.pathFilter());
      setDone({ groupId: res.groupId, code: res.code, bundles: res.bundles.map((b) => ({ serial: b.serial, partyNo: b.partyNo ?? null })), replayed: res.replayed });
    } catch (error) {
      const text = packSaveText(t, error);
      feedback.error();
      announce(`${text.title}. ${text.body}`);
      setProblem(text);
      // A refusal about the Source step sends the packer back to it.
      if (text.kind === "cast" || text.kind === "copy" || text.kind === "owned" || text.kind === "order" || text.kind === "pin" || text.kind === "retired") setStep(0);
    }
  };

  const canNext = canLeaveDefaults({ die, lengthMm: defaultLengthMm, yardCount: yards.length, locationId }) && gate.blockers.length === 0 && !gate.loading;
  const next = () => {
    setTried(true);
    if (canNext) setStep(1);
  };

  const summary = {
    forOrder: source.salesOrderLineId && gate.line ? `${gate.line.orderNumber}/${gate.line.lineNo}` : null,
    copy: source.dieInstanceId ? (gate.copies.data?.items.find((c) => c.id === source.dieInstanceId)?.code ?? null) : null,
    cast: source.castId ? (gate.liveCasts.find((c) => c.id === source.castId)?.number ?? null) : null,
  };

  if (done) {
    const party = partyRange(done.bundles);
    const first = done.bundles[0]?.serial;
    const last = done.bundles[done.bundles.length - 1]?.serial;
    return (
      <>
        <Stack.Screen options={{ title: t("pack.new.title") }} />
        <Screen>
          <View accessibilityLiveRegion="polite" className="gap-2 rounded-block bg-tone-green p-[18px]">
            <Text className="font-display-bold text-xl text-tone-green-on">{t("pack.new.saved")}</Text>
            <Text className="font-mono-semibold text-2xl text-tone-green-on">{done.code}</Text>
            {first && last ? (
              <Text className="font-sans-medium text-[15px] text-tone-green-on">
                {done.bundles.length === 1 ? t("native.pack.serialOne", { serial: first }) : t("native.pack.serialsLine", { count: done.bundles.length, from: first, to: last })}
              </Text>
            ) : null}
            {party ? (
              <Text className="font-mono-semibold text-[17px] text-tone-green-on">
                {party.from === party.to ? t("pack.partyNo1", { number: party.from }) : t("pack.partyNos", { from: party.from, to: party.to })}
              </Text>
            ) : null}
            {done.replayed ? <Text className="font-sans text-sm text-tone-green-on">{t("native.pack.replayedNote")}</Text> : null}
          </View>
          <Button size="lg" label={t("native.pack.openSession", { code: done.code })} onPress={() => router.replace({ pathname: "/pack/[id]", params: { id: done.groupId } } as never)} />
          <Button variant="secondary" label={t("native.pack.packAnother")} onPress={startAnother} />
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t("pack.new.title") }} />
      <Screen>
        <Can do="bundle.create" fallback={<EmptyState title={t("errors.forbidden")} />}>
          {offered ? (
            <View accessibilityLiveRegion="polite" className="gap-3 rounded-card border border-hairline bg-surface-sunken p-4">
              <Text className="font-sans-semibold text-base text-ink">{t("pack.new.draftKept")}</Text>
              <Text className="font-sans text-[15px] text-ink-muted">{t("native.pack.resumeLine", { die: offered.die.label, count: offered.bundles.length })}</Text>
              <Button size="lg" label={t("native.pack.resume")} onPress={() => resume(offered)} />
              <Button variant="secondary" label={t("pack.new.discardDraft")} onPress={discard} />
            </View>
          ) : null}

          {!offered ? (
            <>
              <View className="gap-2">
                <Text accessibilityRole="header" className="font-display-bold text-xl text-ink">
                  {t("native.pack.stepOf", { n: step + 1, total: STEPS.length, name: t(STEPS[step]!) })}
                </Text>
                <View importantForAccessibility="no-hide-descendants" className="flex-row gap-1.5">
                  {STEPS.map((key, i) => (
                    <View key={key} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-surface-sunken")} />
                  ))}
                </View>
              </View>

              {step === 0 ? (
                <DieStep
                  die={die}
                  onPickDie={(d) => {
                    if (d.id !== die?.id) setSource(DEFAULT_SOURCE);
                    setDie(d);
                  }}
                  unit={unit}
                  lengthFields={lengthFields}
                  onLengthFields={setLengthFields}
                  lengthError={tried && defaultLengthMm === null}
                  po={po}
                  onPo={setPo}
                  yards={yards}
                  locationId={locationId}
                  onLocation={setLocationId}
                  yardError={tried && yards.length > 0 && !locationId}
                  canNext={!tried || canNext}
                  onNext={next}
                  source={source}
                  onSource={setSource}
                  gate={gate}
                  sourceError={tried}
                />
              ) : null}

              {step === 1 && die && defaultLengthMm !== null ? (
                <BundlesStep
                  die={die}
                  dieInstanceId={source.dieInstanceId}
                  unit={unit}
                  defaultLengthMm={defaultLengthMm}
                  formatLength={length.formatLength}
                  bundles={bundles}
                  onBundles={setBundles}
                  rejects={rejects}
                  onRejects={setRejects}
                  onBack={() => setStep(0)}
                  onNext={() => setStep(2)}
                />
              ) : null}

              {step === 2 && die && defaultLengthMm !== null ? (
                <ReviewStep
                  die={die}
                  dieInstanceId={source.dieInstanceId}
                  defaultLengthMm={defaultLengthMm}
                  formatLength={length.formatLength}
                  po={po}
                  yard={yard}
                  source={summary}
                  bundles={bundles}
                  rejects={rejects}
                  saving={create.isPending}
                  problem={problem}
                  onSave={() => void save()}
                  onBack={() => setStep(1)}
                />
              ) : null}
            </>
          ) : null}
        </Can>
      </Screen>
    </>
  );
}
