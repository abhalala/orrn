import Feather from "@expo/vector-icons/Feather";
import type { SpectroLimit, SpectroVerdict } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { Sheet } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { replayKey, sendOnce, type ReplayAttempt } from "@/lib/replay-key";
import { writeFailureKind } from "@/lib/request-timeout";
import { useThemeColor } from "@/lib/theme";
import { useFormat } from "@/lib/use-format";
import { reasonOptions } from "@/features/press/reason-label";
import { queryClient, trpc } from "@/utils/trpc";

import { foundryError } from "./errors";
import { bpText, lockedMeltTone, MELT_TONE, verdictTone, type MeltStatus } from "./foundry-model";
import { mmToFtText } from "./melt-form";
import { MELT_TIME_KEYS } from "./melt-times";
import { SpectroPanel } from "./spectro-panel";
import type { CastData, MeltRow } from "./types";
import { ErrorLine, Figure, kgOf, Note, Section } from "./ui";

const TIME_LABEL = {
  preheatStart: "foundry.melt.times.preheatStart",
  chargingStart: "foundry.melt.times.chargingStart",
  chargingEnd: "foundry.melt.times.chargingEnd",
  castingStart: "foundry.melt.times.castingStart",
  castingEnd: "foundry.melt.times.castingEnd",
} as const satisfies Record<(typeof MELT_TIME_KEYS)[number], MessageKey>;
const AT = {
  preheatStart: "preheatStartAt",
  chargingStart: "chargingStartAt",
  chargingEnd: "chargingEndAt",
  castingStart: "castingStartAt",
  castingEnd: "castingEndAt",
} as const;
const MELT_STATUS_KEY: Record<MeltStatus, MessageKey> = {
  draft: "foundry.melt.status.draft",
  locked: "foundry.melt.status.locked",
  cancelled: "foundry.melt.status.cancelled",
  corrected: "foundry.melt.status.corrected",
};
const VERDICT_KEY: Record<SpectroVerdict, MessageKey> = {
  pass: "foundry.spectro.verdict.pass",
  fail: "foundry.spectro.verdict.fail",
  incomplete: "foundry.spectro.verdict.incomplete",
};

/**
 * A melt that is locked or cancelled (or that this person may not edit): every figure as the server stored
 * it and the spectro, read only. A locked melt of an open cast carries the correction request (melt.correct):
 * nothing is edited after the lock; an approver agrees and the melt reopens as a draft copy.
 */
export function MeltSheetView({ data, melt }: { data: CastData; melt: MeltRow }) {
  const { t } = useT();
  const format = useFormat();
  const alloys = useQuery(trpc.foundry.alloys.list.queryOptions());
  const furnaces = useQuery(trpc.foundry.furnaces.list.queryOptions());
  const cast = data.cast;
  const status = melt.status as MeltStatus;
  const furnace = furnaces.data?.items.find((f) => f.id === melt.furnaceId);
  const alloy = alloys.data?.items.find((a) => a.id === (melt.alloyId ?? cast.alloyId)) ?? alloys.data?.items.find((a) => a.code === melt.alloy);
  const live = melt.spectro.filter((s) => !s.voidedAt);
  const verdict = (live[live.length - 1]?.verdict as SpectroVerdict | null | undefined) ?? null;
  const tone = status === "locked" ? lockedMeltTone({ verdict, lossBp: melt.lossBp, warnings: melt.warnings ?? [] }) : (MELT_TONE[status] ?? "neutral");
  const logs = melt.outputs.filter((o) => o.kind === "logs");
  const returns = melt.outputs.filter((o) => o.kind === "return_stream");

  return (
    <Screen>
      <PageHeader title={t("foundry.melt.titleOf", { n: melt.seq, number: cast.number })} right={<Chip tone={tone} label={t(MELT_STATUS_KEY[status] ?? MELT_STATUS_KEY.locked)} />} />
      {status === "cancelled" ? <Note tone="red">{t("foundry.melt.cancelledNote")}</Note> : null}
      {status === "corrected" ? <Note>{t("foundry.melt.correctedNote")}</Note> : null}
      {melt.correctsMeltId ? <Note>{t("foundry.melt.correctsNote", { n: data.melts.find((m) => m.id === melt.correctsMeltId)?.seq ?? "" })}</Note> : null}

      <Section title={t("foundry.melt.sheet.figures")}>
        <View className="flex-row flex-wrap gap-4">
          <Figure label={t("foundry.melt.furnace")} value={furnace?.code ?? "-"} />
          <Figure label={t("foundry.melt.alloy")} value={alloy?.code ?? melt.alloy} />
          <Figure label={t("foundry.cast.panel.metalIn")} value={`${kgOf(melt.inputG)} ${t("units.kg")}`} />
          <Figure label={t("foundry.melt.out.logs")} value={`${kgOf(melt.logsG)} ${t("units.kg")}, ${melt.logsPcs} ${t("units.pcs")}`} />
          <Figure label={t("foundry.melt.out.dross")} value={`${kgOf(melt.drossG)} ${t("units.kg")}`} />
          <Figure label={t("foundry.melt.out.fe")} value={`${kgOf(melt.feG)} ${t("units.kg")}`} />
          <Figure label={t("foundry.cast.panel.burn")} value={`${kgOf(Math.abs(melt.lossG))} ${t("units.kg")} (${bpText(Math.abs(melt.lossBp))}%)`} />
          <Figure label={t("foundry.melt.balance.yieldLabel")} value={melt.yieldBp === null ? "-" : `${bpText(melt.yieldBp)}%`} />
        </View>
        {melt.balanceNote ? <Text className="font-sans text-sm text-ink">{t("foundry.melt.sheet.balanceNote", { note: melt.balanceNote })}</Text> : null}
        {melt.alloyReason ? <Text className="font-sans text-sm text-ink">{t("foundry.melt.sheet.alloyReason", { note: melt.alloyReason })}</Text> : null}
        {melt.spectroReason ? <Text className="font-sans text-sm text-ink">{t("foundry.melt.sheet.spectroReason", { note: melt.spectroReason })}</Text> : null}
        {melt.notes ? <Text className="font-sans text-sm text-ink">{melt.notes}</Text> : null}
      </Section>

      <Section title={t("foundry.melt.steps.times")}>
        <View className="flex-row flex-wrap gap-4">
          {MELT_TIME_KEYS.map((k) => {
            const at = melt[AT[k]];
            return <Figure key={k} label={t(TIME_LABEL[k])} value={at ? `${format.time(at) ?? ""} ${format.day(at) ?? ""}`.trim() : "-"} />;
          })}
        </View>
      </Section>

      <Section title={t("foundry.melt.charge.title")}>
        {melt.inputs.map((i, n) => (
          <View key={n} className="flex-row flex-wrap items-baseline gap-x-3">
            <Text className="font-mono-semibold text-base text-ink">{i.lotNumber ?? i.streamCode}</Text>
            <Text className="font-sans text-sm text-ink-muted">{[i.itemName, i.gradeCode].filter(Boolean).join(" ") || i.streamName}</Text>
            <Text className="font-mono text-base text-ink">{`${kgOf(i.kgG)} ${t("units.kg")}`}</Text>
          </View>
        ))}
        {logs.map((l, n) => (
          <Text key={`l${n}`} className="font-mono text-base text-ink">
            {t("foundry.melt.out.logLine", { pcs: l.pcs ?? 0, ft: mmToFtText(l.lengthMm), kg: kgOf(l.kgG) })}
          </Text>
        ))}
        {returns.map((r, n) => (
          <Text key={`r${n}`} className="font-mono text-base text-ink">{`${r.streamCode}: ${kgOf(r.kgG)} ${t("units.kg")}`}</Text>
        ))}
      </Section>

      <Section title={t("foundry.spectro.title")}>
        {verdict ? <Chip tone={verdictTone(verdict)} label={t(VERDICT_KEY[verdict])} /> : null}
        <SpectroPanel meltId={null} results={melt.spectro} limits={(alloy?.limits ?? []) as SpectroLimit[]} alloyCode={alloy?.code ?? melt.alloy} draft={false} readOnly />
      </Section>

      {status === "locked" && cast.status === "open" ? <Correction melt={melt} /> : null}
    </Screen>
  );
}

/** The correction request and what comes of it (approval `melt_correct`): ask, wait, then correct once an approver agrees. */
function Correction({ melt }: { melt: MeltRow }) {
  const { t } = useT();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const attempt = useRef<ReplayAttempt>(null);
  // This melt's own requests, newest first (not the plant's newest hundred, which would drop an old pending one).
  const list = useQuery(trpc.approval.list.queryOptions({ kind: "melt_correct", subjectId: melt.id, limit: 20, offset: 0 }));
  const mine = list.data?.items ?? [];
  const open = mine.find((a) => a.status === "pending" || (a.status === "approved" && (a.meta as { usedAt?: unknown } | null)?.usedAt == null));
  const rejected = !open ? mine.find((a) => a.status === "rejected") : undefined;
  const correct = useMutation(trpc.foundry.melts.correct.mutationOptions());

  const correctNow = async () => {
    setProblem(null);
    try {
      const body = { meltId: melt.id };
      const next = replayKey(attempt.current, body, randomId);
      attempt.current = next.attempt;
      const res = await sendOnce((clientRequestId) => correct.mutateAsync({ ...body, clientMutationId: clientRequestId }), next.id);
      attempt.current = null;
      feedback.success();
      announce(t("foundry.melt.correction.done"));
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() });
      router.replace({ pathname: "/cast/melt/[meltId]", params: { meltId: res.draftId, castId: res.castId } } as never);
    } catch (error) {
      feedback.error();
      setProblem(error);
      announce(foundryError(t, error));
      if (writeFailureKind(error) === "unsure") void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
    }
  };

  return (
    <Can do="melt.correct">
      <Section title={t("foundry.melt.correction.title")} hint={t("foundry.melt.correction.body")}>
        {open?.status === "pending" ? <Note tone="amber">{t("foundry.melt.correction.pending")}</Note> : null}
        {rejected ? <Note tone="red">{rejected.note ? `${t("foundry.melt.correction.rejected")} ${rejected.note}` : t("foundry.melt.correction.rejected")}</Note> : null}
        {open?.status === "approved" ? (
          <Button size="lg" label={t("foundry.melt.correction.now")} loading={correct.isPending} onPress={() => void correctNow()} />
        ) : !open && !list.isPending ? (
          <Button variant="secondary" size="lg" label={t("foundry.melt.correction.ask")} onPress={() => setAsking(true)} />
        ) : null}
        <ErrorLine error={problem} />
        <AskSheet meltId={melt.id} visible={asking} onClose={() => setAsking(false)} />
      </Section>
    </Can>
  );
}

function AskSheet({ meltId, visible, onClose }: { meltId: string; visible: boolean; onClose: () => void }) {
  const { t, locale } = useT();
  const ink = useThemeColor("foreground");
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "melt_correct" }), enabled: visible });
  const options = reasonOptions(t, "melt_correct", reasons.data, locale);
  const ask = useMutation(trpc.foundry.melts.requestCorrection.mutationOptions());
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const row = reasons.data?.find((r) => r.code === code);
  const needsNote = options.find((o) => o.value === code)?.requiresNote ?? false;

  const done = () => {
    setCode("");
    setNote("");
    setTried(false);
    setProblem(null);
    onClose();
  };

  const send = async () => {
    setTried(true);
    if (!row || (needsNote && !note.trim())) return;
    setProblem(null);
    try {
      await ask.mutateAsync({ meltId, reasonCodeId: row.id, ...(note.trim() ? { note: note.trim() } : {}) });
      feedback.success();
      announce(t("foundry.melt.correction.sent"));
      void queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() });
      done();
    } catch (error) {
      feedback.error();
      setProblem(error);
      announce(foundryError(t, error));
      // An unsure answer may have sent it: the approvals are read again before anyone asks twice.
      if (writeFailureKind(error) === "unsure") void queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() });
    }
  };

  return (
    <Sheet visible={visible} onClose={done} title={t("foundry.melt.correction.askTitle")}>
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("foundry.melt.correction.reason")}
      </Text>
      <View accessibilityRole="radiogroup" className="gap-2">
        {options.map((o) => {
          const selected = o.value === code;
          return (
            <ListRow
              key={o.value}
              title={o.label}
              className={cn(selected && "border-primary")}
              radioChecked={selected}
              trailing={selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : undefined}
              onPress={() => setCode(o.value)}
            />
          );
        })}
      </View>
      {tried && !row ? <Text className="font-sans text-sm text-destructive">{t("foundry.melt.correction.reasonRequired")}</Text> : null}
      <Field label={t("foundry.melt.correction.note")} value={note} onChangeText={setNote} multiline maxLength={500} error={tried && needsNote && !note.trim() ? t("foundry.melt.correction.noteRequired") : null} />
      <ErrorLine error={problem} />
      <Button size="lg" label={t("foundry.melt.correction.send")} loading={ask.isPending} onPress={() => void send()} />
    </Sheet>
  );
}
