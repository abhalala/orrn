import { useT } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { replayKey, sendOnce, type ReplayAttempt } from "@/lib/replay-key";
import { trpc } from "@/utils/trpc";

import { applyPadKey, milliKgText, parseKgToMilli, type PadKey } from "./copy-model";
import { dieErrorText } from "./errors";
import { useRefreshDieRoom } from "./use-die-write";

const ROWS: readonly (readonly PadKey[])[] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  [".", "0", "back"],
];

/**
 * The reading keypad: weigh 12 ft off the die, key the kg, save. The server works out the percent,
 * the colour and the band position (shown on the card after saving); the pad only checks that the
 * text is a weight. A failed save leaves what was keyed, so the person can try again.
 */
export function ReadingPanel({
  copyId,
  code,
  lastMilli,
  bandText,
  onSaved,
}: {
  copyId: string;
  code: string;
  lastMilli: number | null;
  bandText: string | null;
  onSaved?: () => void;
}) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useMutation(trpc.dieInstance.addReading.mutationOptions());
  // BACKLOG 47: one key per keyed reading; a lost reply is sent once more with it and never adds twice.
  const attempt = useRef<ReplayAttempt>(null);
  const milli = parseKgToMilli(text);

  const keyLabel = (key: PadKey) => (key === "back" ? t("dieRoom.reading.backspace") : key === "." ? t("native.dies.pad.point") : key);

  async function save() {
    if (milli == null) return;
    setError(null);
    try {
      const body = { dieInstanceId: copyId, kgPer12ftMilli: milli };
      const next = replayKey(attempt.current, body, randomId);
      attempt.current = next.attempt;
      await sendOnce((clientRequestId) => add.mutateAsync({ ...body, clientRequestId }), next.id);
      attempt.current = null;
      feedback.success();
      announce(t("dieRoom.reading.saved", { code, kg: milliKgText(milli) }));
      setText("");
      refresh();
      onSaved?.();
    } catch (e) {
      feedback.error();
      setError(dieErrorText(t, e));
    }
  }

  return (
    <View className="gap-4 rounded-card border border-hairline bg-surface p-5">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {t("dieRoom.reading.title", { code })}
      </Text>
      <Text className="font-sans text-sm text-ink-muted">
        {lastMilli == null ? t("dieRoom.reading.noneYet") : t("dieRoom.reading.last", { kg: milliKgText(lastMilli) })}
        {bandText ? ` ${t("dieRoom.reading.bandHint", { band: bandText })}` : ""}
      </Text>

      <View
        accessible
        accessibilityLabel={`${t("dieRoom.reading.weight")}, ${text === "" ? t("common.required") : text}`}
        accessibilityLiveRegion="polite"
        className="min-h-16 flex-row items-center justify-end gap-2 rounded-input border border-control bg-canvas px-4"
      >
        <Text className="font-mono-semibold text-[34px] text-ink">{text === "" ? "0.000" : text}</Text>
        <Text importantForAccessibility="no" className="font-sans-semibold text-base text-ink-muted">
          {t("units.kgPer12ft")}
        </Text>
      </View>

      <View className="gap-2">
        {ROWS.map((row) => (
          <View key={row.join("")} className="flex-row gap-2">
            {row.map((key) => (
              <PressableScale
                key={key}
                accessibilityRole="button"
                accessibilityLabel={keyLabel(key)}
                onPress={() => {
                  setError(null);
                  setText((cur) => applyPadKey(cur, key));
                }}
                disabled={add.isPending}
                className="min-h-16 flex-1 items-center justify-center rounded-card border border-control bg-surface"
              >
                <Text className="font-mono-semibold text-2xl text-ink">{key === "back" ? "⌫" : key}</Text>
              </PressableScale>
            ))}
          </View>
        ))}
      </View>

      <Text className="font-sans text-sm text-ink-muted">{t("dieRoom.reading.serverFigures")}</Text>
      {text !== "" && milli == null ? <Text className="font-sans text-sm text-destructive">{t("dieRoom.band.kgInvalid")}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink">
          {error}
        </Text>
      ) : null}
      <Button size="lg" label={t("native.dies.saveReading")} loading={add.isPending} loadingLabel={t("common.saving")} disabled={milli == null} onPress={() => void save()} />
    </View>
  );
}
