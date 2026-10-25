import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { NumberInput } from "@/components/ui/number-input";
import { Sheet } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { replayKey, sendOnce, type ReplayAttempt } from "@/lib/replay-key";
import { writeFailureKind } from "@/lib/request-timeout";
import { useThemeColor } from "@/lib/theme";
import { useDebounced } from "@/features/more/use-debounced";
import { reasonOptions } from "@/features/press/reason-label";
import { queryClient, trpc } from "@/utils/trpc";

import { foundryError } from "./errors";
import { bpText, closeAdvice, closeFormIssue, countedBillets, countKey } from "./foundry-model";
import type { CastData } from "./types";
import { ErrorLine, Figure, kgOf, Note } from "./ui";

/**
 * Close a cast (cast.close holders; the caller wraps it in <Can>). The closer counts the billets left in the
 * yard (pieces and kg weighed together); `casts.closePreview` answers with the tail, whether a reason is
 * required and whether a second person must approve. The chip is green when the count leaves no tail and
 * amber when it does; the reason is required exactly when the server says so. The close carries a
 * `clientMutationId`, so a resent close answers the first one.
 */
export function CloseSheet({ visible, onClose, cast }: { visible: boolean; onClose: () => void; cast: CastData }) {
  const { t, locale } = useT();
  const ink = useThemeColor("foreground");
  const co = cast.closeout;
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "cast_tail" }), enabled: visible });
  const options = reasonOptions(t, "cast_tail", reasons.data, locale);
  const [pcs, setPcs] = useState("");
  const [kg, setKg] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const attempt = useRef<ReplayAttempt>(null);
  const close = useMutation(trpc.foundry.casts.close.mutationOptions());

  const count = countedBillets(pcs, kg);
  // The server is asked once the count stops changing, not on every key; Confirm waits for the answer to the count on screen.
  const key = useDebounced(countKey(count), 350);
  const live = countKey(count);
  const settled = count.ok && key === live ? count.billetsOnHand : null;
  const preview = useQuery({
    ...trpc.foundry.casts.closePreview.queryOptions({ castId: cast.cast.id, billetsOnHand: settled ?? { count: 0, kgG: 0 } }),
    enabled: visible && settled !== null,
    placeholderData: keepPreviousData,
  });
  const p = settled && !preview.isPlaceholderData ? preview.data : undefined;
  const checking = count.ok && (key !== live || preview.isFetching);
  const advice = closeAdvice(p);
  const issue = p ? closeFormIssue(p, { reasonCode, note }, reasons.data ?? []) : null;
  const row = reasons.data?.find((r) => r.code === reasonCode);
  const countError = tried && !count.ok ? count.issue : null;

  const finish = () => {
    setPcs("");
    setKg("");
    setReasonCode("");
    setNote("");
    setTried(false);
    setProblem(null);
    onClose();
  };

  const confirm = async () => {
    setTried(true);
    if (!count.ok || !p || issue || checking) return;
    setProblem(null);
    try {
      const body = { castId: cast.cast.id, billetsOnHand: count.billetsOnHand, ...(row ? { reasonCodeId: row.id } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
      const next = replayKey(attempt.current, body, randomId);
      attempt.current = next.attempt;
      const res = await sendOnce((clientRequestId) => close.mutateAsync({ ...body, clientMutationId: clientRequestId }), next.id);
      attempt.current = null;
      feedback.success();
      announce(res.status === "closing" ? t("foundry.cast.close.sent", { number: res.number }) : t("foundry.cast.close.closed", { number: res.number }));
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.stock.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() });
      finish();
    } catch (error) {
      feedback.error();
      setProblem(error);
      announce(foundryError(t, error));
      // An unsure answer may have closed it: re-read before anyone taps again.
      if (writeFailureKind(error) === "unsure") void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
    }
  };

  return (
    <Sheet visible={visible} onClose={finish} title={t("foundry.cast.close.title", { number: cast.cast.number })}>
      <View className="flex-row flex-wrap gap-4">
        <Figure label={t("foundry.cast.panel.produced")} value={`${kgOf(co.producedG)} ${t("units.kg")}`} />
        <Figure label={t("foundry.cast.panel.pressed")} value={`${kgOf(co.creditedG)} ${t("units.kg")}`} />
        <Figure label={t("foundry.cast.close.ledgerOnHand")} value={`${kgOf(co.billetsOnHandG)} ${t("units.kg")}`} />
        <Figure label={t("foundry.cast.panel.tail")} value={p ? `${p.tailG < 0 ? "-" : ""}${kgOf(Math.abs(p.tailG))} ${t("units.kg")}${p.tailBp !== null ? ` (${bpText(p.tailBp)}%)` : ""}` : "-"} strong />
      </View>

      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("foundry.cast.close.countTitle")}
      </Text>
      <Text className="font-sans text-sm text-ink-muted">{t("foundry.cast.close.countHint")}</Text>
      <View className="flex-row gap-3">
        <NumberInput className="flex-1" integer label={t("foundry.cast.close.pcs")} value={pcs} onChangeText={setPcs} error={countError === "pcs" ? t("foundry.cast.close.pcsInvalid") : null} />
        <NumberInput className="flex-1" label={t("foundry.cast.close.kg")} unit={t("units.kg")} value={kg} onChangeText={setKg} error={countError === "kg" ? t("foundry.cast.close.kgInvalid") : null} />
      </View>
      {!count.ok && count.issue === "together" ? <Note tone="amber">{t("foundry.cast.close.together")}</Note> : null}
      {!p && !(count.ok === false && count.issue === "together") ? <Note>{t("foundry.cast.close.waitingCount")}</Note> : null}

      {p && advice ? (
        <View accessibilityLiveRegion="polite" className="gap-3">
          <Chip tone={advice.tone} label={advice.tone === "green" ? t("foundry.cast.tailChip.balanced") : t("foundry.cast.close.tailIs", { kg: `${p.tailG < 0 ? "-" : ""}${kgOf(Math.abs(p.tailG))}` })} />
          {p.shortG > 0 ? <Note tone="red">{t("foundry.cast.close.short", { kg: kgOf(p.shortG) })}</Note> : null}
          {p.tailG < 0 && p.shortG === 0 ? <Note tone="amber">{t("foundry.cast.close.countOver", { kg: kgOf(-p.tailG) })}</Note> : null}
          <Text className="font-sans text-sm text-ink-muted">
            {p.adjustG !== 0 ? t("foundry.cast.close.adjust", { kg: `${p.adjustG < 0 ? "-" : "+"}${kgOf(Math.abs(p.adjustG))}` }) : t("foundry.cast.close.adjustNone")}
          </Text>
          {!advice.reasonRequired ? <Note tone="green">{t("foundry.cast.close.clean")}</Note> : null}
          {advice.approval ? <Note tone="amber">{t("foundry.cast.close.needsApproval")}</Note> : null}
        </View>
      ) : null}

      {advice?.reasonRequired ? (
        <View className="gap-3">
          <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
            {t("foundry.cast.close.reason")}
          </Text>
          <View accessibilityRole="radiogroup" className="gap-2">
            {options.map((o) => {
              const selected = o.value === reasonCode;
              return (
                <ListRow
                  key={o.value}
                  title={o.label}
                  className={cn(selected && "border-primary")}
                  radioChecked={selected}
                  trailing={selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : undefined}
                  onPress={() => setReasonCode(o.value)}
                />
              );
            })}
          </View>
          {tried && issue === "reason" ? <Text className="font-sans text-sm text-destructive">{t("foundry.cast.close.reasonRequired")}</Text> : null}
          <Field label={t("foundry.cast.close.note")} value={note} onChangeText={setNote} multiline maxLength={500} error={tried && issue === "note" ? t("foundry.cast.close.noteRequired") : null} />
        </View>
      ) : null}

      <ErrorLine error={problem ?? (count.ok ? preview.error : null)} />
      <Button size="lg" label={advice?.approval ? t("foundry.cast.close.askButton") : t("foundry.cast.close.confirm")} loading={close.isPending || checking} onPress={() => void confirm()} />
    </Sheet>
  );
}
