import Feather from "@expo/vector-icons/Feather";
import { useT, type MessageKey } from "@orrn/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useGuardedWrite } from "@/features/ageing/use-ageing";
import { useThemeColor } from "@/lib/theme";
import { trpc } from "@/utils/trpc";

import { dmy } from "./explain";
import { leaveError } from "./errors";
import { canCancel, daysText, isNotLinked, leaveInput, statusTone, type LeaveForm, type Request } from "./model";
import { Note, Section } from "./ui";

/**
 * More > My work > Leave: ask for leave and see my requests; a waiting one can be cancelled. Both writes are unkeyed and
 * guarded by the server's status checks (an overlapping leave and a cancel of a request that is not waiting are refused);
 * the screen never sends one twice by itself, and after an answer that never came it reads the list again and says so.
 */
export function LeaveView() {
  const { t } = useT();
  const qc = useQueryClient();
  const summary = useQuery(trpc.hr.me.summary.queryOptions());
  const kinds = useQuery(trpc.hr.leave.kinds.queryOptions());
  const requests = useQuery(trpc.hr.me.leave.queryOptions());
  const ink = useThemeColor("foreground");
  const [form, setForm] = useState<{ kindId: string; from: string | null; to: string | null; halfDay: boolean; reason: string }>({ kindId: "", from: null, to: null, halfDay: false, reason: "" });
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState(false);

  const reread = () => Promise.all([requests.refetch(), summary.refetch()]);
  const apply = useMutation(trpc.hr.me.applyLeave.mutationOptions());
  const cancel = useMutation(trpc.hr.me.cancelLeave.mutationOptions());
  const applyWrite = useGuardedWrite(reread);
  const cancelWrite = useGuardedWrite(reread);

  const today = summary.data?.today ?? "";
  const value: LeaveForm = { kindId: form.kindId, from: form.from ?? today, to: form.to ?? form.from ?? today, halfDay: form.halfDay, reason: form.reason };
  const checked = leaveInput(value);
  const refresh = () => {
    void qc.invalidateQueries(trpc.hr.me.pathFilter());
    void qc.invalidateQueries(trpc.approval.pathFilter());
  };

  if ((summary.isError && !summary.data) || (kinds.isError && !kinds.data)) {
    const error = summary.error ?? kinds.error;
    return (
      <Screen>
        {isNotLinked(error) ? <Note>{t("native.hr.notLinked")}</Note> : <ErrorBlock error={error} onRetry={() => void Promise.all([summary.refetch(), kinds.refetch()])} />}
      </Screen>
    );
  }
  if (!summary.data || !kinds.data) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  async function send() {
    setTried(true);
    setSent(false);
    if (!checked.ok) return;
    const res = await applyWrite.run(() => apply.mutateAsync(checked.input));
    if (res) {
      setSent(true);
      setTried(false);
      setForm((f) => ({ ...f, reason: "", halfDay: false }));
      refresh();
    }
  }

  function askCancel(r: Request) {
    Alert.alert(t("native.hr.leave.cancelTitle"), t("native.hr.leave.cancelBody"), [
      { text: t("native.hr.leave.keep"), style: "cancel" },
      {
        text: t("native.hr.leave.cancel"),
        style: "destructive",
        onPress: () => {
          void cancelWrite.run(() => cancel.mutateAsync({ id: r.id })).then((res) => {
            if (res) refresh();
          });
        },
      },
    ]);
  }

  const active = kinds.data.filter((k) => k.active);
  const needKind = tried && !checked.ok && checked.error === "needKind";
  const needDays = tried && !checked.ok && checked.error === "needDays";
  const rows = requests.data ?? [];

  return (
    <Screen onRefresh={() => void reread()} refreshing={requests.isRefetching}>
      <Can do="leave.apply">
        <Section title={t("native.hr.leave.apply")}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("native.hr.leave.kind")} className="gap-2">
            <Text className="font-sans-medium text-sm text-ink">{t("native.hr.leave.kind")}</Text>
            {active.map((k) => (
              <ListRow key={k.id} title={k.name} radioChecked={form.kindId === k.id} onPress={() => setForm((f) => ({ ...f, kindId: k.id }))} />
            ))}
            {needKind ? (
              <Text accessibilityLiveRegion="polite" className="font-sans-medium text-sm text-destructive">
                {t("native.hr.leave.needKind")}
              </Text>
            ) : null}
          </View>
          <Field label={t("native.hr.leave.from")} hint={t("native.hr.leave.dateHint")} mono value={value.from} onChangeText={(v) => setForm((f) => ({ ...f, from: v }))} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={10} />
          <Field label={t("native.hr.leave.to")} hint={t("native.hr.leave.dateHint")} error={needDays ? t("native.hr.leave.needDays") : null} mono value={value.to} onChangeText={(v) => setForm((f) => ({ ...f, to: v }))} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={10} />
          <PressableScale
            accessibilityRole="checkbox"
            accessibilityState={{ checked: form.halfDay }}
            accessibilityLabel={t("native.hr.leave.halfDay")}
            onPress={() => setForm((f) => ({ ...f, halfDay: !f.halfDay }))}
            className="min-h-14 flex-row items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3"
          >
            <Feather name={form.halfDay ? "check-square" : "square"} size={22} color={ink} importantForAccessibility="no" />
            <Text className="min-w-0 flex-1 font-sans-semibold text-base text-ink">{t("native.hr.leave.halfDay")}</Text>
          </PressableScale>
          <Field label={t("native.hr.leave.reason")} value={form.reason} onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))} maxLength={300} />
          {applyWrite.error ? <Note tone="red">{leaveError(t, applyWrite.error)}</Note> : null}
          {sent && !applyWrite.error ? <Note tone="green">{t("native.hr.leave.sent")}</Note> : null}
          <Button size="lg" label={t("native.hr.leave.send")} loading={applyWrite.pending} onPress={() => void send()} />
        </Section>
      </Can>

      <Section title={t("native.hr.leave.requests")}>
        {cancelWrite.error ? <Note tone="red">{leaveError(t, cancelWrite.error)}</Note> : null}
        {rows.length === 0 ? (
          <Text className="font-sans text-[15px] text-ink-muted">{t("native.hr.leave.empty")}</Text>
        ) : (
          rows.map((r) => (
            <View key={r.id} className="gap-2 border-b border-hairline pb-3 last:border-b-0 last:pb-0">
              <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="font-sans-semibold text-base text-ink">{r.kindName}</Text>
                  <Text className="font-mono text-sm text-ink-muted">{t("native.hr.leave.range", { from: dmy(r.fromDay), to: dmy(r.toDay) })}</Text>
                  <Text className="font-sans text-sm text-ink-muted">{t("native.hr.leave.days", { days: daysText(r.halves) })}</Text>
                </View>
                <Chip tone={statusTone(r.status)} label={t(`native.hr.status.${r.status}` as MessageKey)} />
              </View>
              {canCancel(r.status) ? <Button variant="secondary" label={t("native.hr.leave.cancel")} loading={cancelWrite.pending && cancel.variables?.id === r.id} onPress={() => askCancel(r)} /> : null}
            </View>
          ))
        )}
      </Section>
    </Screen>
  );
}
