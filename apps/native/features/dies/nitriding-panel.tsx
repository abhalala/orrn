import { useT } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Sheet } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import { parseHardness } from "./copy-model";
import { dieErrorText } from "./errors";
import { useRefreshDieRoom } from "./use-die-write";

type NitridingRow = { id: string; nitridedAt: Date | string | number; hardness: number | null };

/**
 * Nitriding on the phone: out (HV before, a note) and back (HV after). The chemicals are written on
 * the web card. A failed save keeps the sheet and what was typed.
 */
export function NitridingPanel({
  copyId,
  code,
  status,
  canOut,
  canBack,
  rows,
}: {
  copyId: string;
  code: string;
  status: string;
  canOut: boolean;
  canBack: boolean;
  rows: readonly NitridingRow[];
}) {
  const { t } = useT();
  const format = useFormat();
  const refresh = useRefreshDieRoom();
  const [open, setOpen] = useState<"out" | "back" | null>(null);
  const [hv, setHv] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const out = useMutation(trpc.dieInstance.nitridingOut.mutationOptions());
  const back = useMutation(trpc.dieInstance.nitridingBack.mutationOptions());
  const hardness = parseHardness(hv);
  const hvInvalid = hv.trim() !== "" && hardness == null;
  const busy = out.isPending || back.isPending;

  function close() {
    setOpen(null);
    setError(null);
  }

  async function submit() {
    if (hvInvalid) return;
    setError(null);
    try {
      if (open === "out") {
        await out.mutateAsync({ dieInstanceId: copyId, ...(hardness != null ? { hardness } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
        announce(t("dieRoom.nitriding.sent", { code }));
      } else {
        await back.mutateAsync({ dieInstanceId: copyId, ...(hardness != null ? { hardness } : {}) });
        announce(t("dieRoom.nitriding.returned", { code }));
      }
      feedback.success();
      setHv("");
      setNotes("");
      setOpen(null);
      refresh();
    } catch (e) {
      feedback.error();
      setError(dieErrorText(t, e));
    }
  }

  const showButtons = (canOut && status === "available") || (canBack && status === "at_nitriding");

  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-5">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {t("dieRoom.tabs.nitriding")}
      </Text>
      {rows.length === 0 ? (
        <Text className="font-sans text-[15px] text-ink-muted">{t("dieRoom.nitriding.empty")}</Text>
      ) : (
        <View className="gap-2">
          {rows.slice(0, 5).map((row) => (
            <View key={row.id} className="flex-row justify-between gap-3">
              <Text className="font-sans text-[15px] text-ink">{format.day(row.nitridedAt) ?? ""}</Text>
              <Text className="font-mono text-[15px] text-ink-muted">
                {row.hardness != null ? t("dieRoom.nitriding.hardness", { hv: row.hardness }) : t("dieRoom.nitriding.noHardness")}
              </Text>
            </View>
          ))}
        </View>
      )}
      {showButtons ? (
        canOut && status === "available" ? (
          <Button variant="secondary" label={t("dieRoom.nitriding.send")} onPress={() => setOpen("out")} />
        ) : (
          <Button variant="secondary" label={t("dieRoom.nitriding.back")} onPress={() => setOpen("back")} />
        )
      ) : null}

      <Sheet visible={open !== null} onClose={close} title={open === "out" ? t("dieRoom.nitriding.sendTitle", { code }) : t("dieRoom.nitriding.backTitle", { code })}>
        <NumberInput
          label={open === "out" ? t("dieRoom.nitriding.hvLabel") : t("dieRoom.nitriding.hvAfter")}
          unit="HV"
          integer
          value={hv}
          onChangeText={setHv}
          error={hvInvalid ? t("dieRoom.nitriding.hvInvalid") : null}
        />
        {open === "out" ? <Field label={t("common.notes")} value={notes} onChangeText={setNotes} maxLength={500} multiline /> : null}
        <Text className="font-sans text-sm text-ink-muted">{t("native.dies.chemicalsOnWeb")}</Text>
        {error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink">
            {error}
          </Text>
        ) : null}
        <Button
          size="lg"
          label={open === "out" ? t("dieRoom.nitriding.send") : t("dieRoom.nitriding.back")}
          loading={busy}
          loadingLabel={t("common.saving")}
          disabled={hvInvalid}
          onPress={() => void submit()}
        />
      </Sheet>
    </View>
  );
}
