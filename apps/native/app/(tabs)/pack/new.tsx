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
import { canLeaveDefaults, draftOwner, type PickedDie } from "@/features/pack/pack-form";
import {
  activeYards,
  lengthFieldsToMm,
  lengthToFields,
  receiptPayload,
  type DraftBundle,
  type LengthFields,
} from "@/features/pack/pack-math";
import { ReviewStep, type SaveProblem } from "@/features/pack/review-step";
import { decideAfterCheck, type SessionRow } from "@/features/pack/save-check";
import { DRAFT_VERSION, type PackDraft } from "@/features/pack/draft-store";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { clearPackDraft, readPackDraft, writePackDraft } from "@/lib/pack-draft-file";
import { writeFailureKind } from "@/lib/request-timeout";
import { saveErrorText } from "@/lib/save-error";
import { useLengthUnit } from "@/utils/length";
import { useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

const BLANK_LENGTH: LengthFields = { mm: "", feet: "", inches: "" };
const STEPS = ["pack.new.steps.die", "pack.new.steps.bundles", "pack.new.steps.review"] as const;

export default function NewPackSessionScreen() {
  const { t } = useT();
  const router = useRouter();
  const me = useMe().data;
  const length = useLengthUnit();
  const unit = length.unit;
  const owner = draftOwner(me?.user?.id, me?.company?.id);

  const [step, setStep] = useState(0);
  const [die, setDie] = useState<PickedDie | null>(null);
  const [lengthFields, setLengthFields] = useState<LengthFields>(BLANK_LENGTH);
  const [po, setPo] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<DraftBundle[]>([]);
  const [tried, setTried] = useState(false);

  // The unsaved draft on the phone: offered back once, then kept in step with the screen.
  const [offered, setOffered] = useState<PackDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [done, setDone] = useState(false);

  // Save state. "unsure" keeps Save hidden until a re-read says the session did not land.
  const create = useMutation(trpc.bundle.createReceipt.mutationOptions());
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const attempt = useRef<{ dieId: string; bundleCount: number; startedAt: number } | null>(null);

  const locations = useQuery(trpc.stock.locations.list.queryOptions());
  const yards = activeYards(locations.data?.items);
  const yard = yards.find((y) => y.id === locationId) ?? null;
  useEffect(() => {
    if (yards.length === 1 && !locationId) setLocationId(yards[0]!.id);
  }, [yards, locationId]);

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
    void writePackDraft({ version: DRAFT_VERSION, owner, die, unit, lengthFields, po, locationId, bundles, savedAt: Date.now() });
  }, [draftReady, offered, done, owner, die, unit, lengthFields, po, locationId, bundles]);

  const resume = useCallback(
    (d: PackDraft) => {
      // A draft typed in the other unit still holds the same mm; show it in today's unit.
      const mm = lengthFieldsToMm(d.unit, d.lengthFields);
      setDie(d.die);
      setLengthFields(mm !== null ? lengthToFields(mm, unit) : BLANK_LENGTH);
      setPo(d.po);
      setLocationId(d.locationId);
      setBundles(d.bundles);
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

  const finish = async (groupId: string) => {
    setDone(true);
    await clearPackDraft();
    feedback.success();
    announce(t("pack.new.saved"));
    await Promise.all([
      queryClient.invalidateQueries(trpc.bundle.pathFilter()),
      queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
      queryClient.invalidateQueries(trpc.stock.pathFilter()),
    ]);
    router.replace({ pathname: "/pack/[id]", params: { id: groupId } } as never);
  };

  /** Re-read the newest sessions to learn whether an "unsure" save landed. */
  const check = async () => {
    const save = attempt.current;
    if (!save) return;
    setChecking(true);
    setCheckNote(null);
    let rows: readonly SessionRow[] | null = null;
    try {
      const res = await queryClient.fetchQuery({ ...trpc.bundle.listGroups.queryOptions({ limit: 10 }), staleTime: 0 });
      rows = res.items;
    } catch {
      rows = null;
    }
    const outcome = decideAfterCheck(rows, save);
    setChecking(false);
    if (outcome.kind === "landed") {
      announce(t("native.pack.landed"));
      await finish(outcome.id);
    } else if (outcome.kind === "notLanded") {
      setProblem({ kind: "failed", title: t("native.pack.notLanded"), body: "" });
      announce(t("native.pack.notLanded"));
    } else {
      setCheckNote(t("native.pack.checkFailed"));
    }
  };

  const save = async () => {
    if (!die || defaultLengthMm === null || bundles.length === 0) return;
    setProblem(null);
    setCheckNote(null);
    attempt.current = { dieId: die.id, bundleCount: bundles.length, startedAt: Date.now() };
    try {
      const res = await create.mutateAsync(
        receiptPayload({ dieId: die.id, unit, defaults: { lengthMm: defaultLengthMm, po }, locationId: locationId ?? undefined, bundles }),
      );
      await finish(res.groupId);
    } catch (error) {
      const text = saveErrorText(t, error);
      feedback.error();
      announce(`${text.title}. ${text.body}`);
      setProblem(text);
      if (writeFailureKind(error) === "unsure") await check();
    }
  };

  const canNext = canLeaveDefaults({ die, lengthMm: defaultLengthMm, yardCount: yards.length, locationId });
  const next = () => {
    setTried(true);
    if (canNext) setStep(1);
  };

  return (
    <>
      <Stack.Screen options={{ title: t("pack.new.title") }} />
      <Screen>
        <Can
          do="bundle.create"
          fallback={<EmptyState title={t("errors.forbidden")} />}
        >
          {offered ? (
            <View accessibilityLiveRegion="polite" className="gap-3 rounded-card border border-hairline bg-surface-sunken p-4">
              <Text className="font-sans-semibold text-base text-ink">{t("pack.new.draftKept")}</Text>
              <Text className="font-sans text-[15px] text-ink-muted">
                {t("native.pack.resumeLine", { die: offered.die.label, count: offered.bundles.length })}
              </Text>
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
                  onPickDie={setDie}
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
                />
              ) : null}

              {step === 1 && die && defaultLengthMm !== null ? (
                <BundlesStep
                  die={die}
                  unit={unit}
                  defaultLengthMm={defaultLengthMm}
                  formatLength={length.formatLength}
                  bundles={bundles}
                  onBundles={setBundles}
                  onBack={() => setStep(0)}
                  onNext={() => setStep(2)}
                />
              ) : null}

              {step === 2 && die && defaultLengthMm !== null ? (
                <ReviewStep
                  die={die}
                  defaultLengthMm={defaultLengthMm}
                  formatLength={length.formatLength}
                  po={po}
                  yard={yard}
                  bundles={bundles}
                  saving={create.isPending}
                  problem={problem}
                  checkNote={checkNote}
                  checking={checking}
                  onSave={() => void save()}
                  onCheckAgain={() => void check()}
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
