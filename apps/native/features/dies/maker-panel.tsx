import { useT, type MessageKey } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import { ChoiceRow } from "./choice-row";
import { milliKgText, parseKgToMilli } from "./copy-model";
import { dieErrorText } from "./errors";
import { useRefreshDieRoom } from "./use-die-write";

type Purpose = "trial" | "correction" | "repair";
const PURPOSE_KEY: Record<Purpose, MessageKey> = {
  trial: "dieRoom.maker.trial",
  correction: "dieRoom.maker.correction",
  repair: "dieRoom.maker.repair",
};

type OpenJob = { id: string; number: string; dieMakerId: string; purpose: string; sentAt: Date | string | number } | null;

/**
 * Send a rack copy to a die maker for a trial, a correction or a repair, and receive it back (with a
 * trial weight, which is not a drift reading) or cancel the send. One open job per copy; the server
 * refuses anything else with a sentence that names the copy.
 */
export function MakerPanel({
  copyId,
  code,
  status,
  canSend,
  allowed,
  job,
  trialMilli,
}: {
  copyId: string;
  code: string;
  status: string;
  canSend: boolean;
  /** Holds die.maker (receive / cancel). */
  allowed: boolean;
  job: OpenJob;
  /** The trial weight already on the card, which a received trial weight never replaces. */
  trialMilli: number | null;
}) {
  const { t } = useT();
  const format = useFormat();
  const refresh = useRefreshDieRoom();
  const [sheet, setSheet] = useState<"send" | "receive" | "cancel" | null>(null);
  const [makerId, setMakerId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<Purpose>("trial");
  const [note, setNote] = useState("");
  const [trial, setTrial] = useState("");
  const [error, setError] = useState<string | null>(null);

  const makers = useQuery({ ...trpc.dieInstance.maker.list.queryOptions(), enabled: sheet === "send" || job !== null });
  const send = useMutation(trpc.dieInstance.maker.jobs.send.mutationOptions());
  const receive = useMutation(trpc.dieInstance.maker.jobs.receive.mutationOptions());
  const cancel = useMutation(trpc.dieInstance.maker.jobs.cancel.mutationOptions());

  const trialMilliTyped = parseKgToMilli(trial);
  const trialInvalid = trial.trim() !== "" && trialMilliTyped == null;
  const makerName = job ? (makers.data?.find((m) => m.id === job.dieMakerId)?.name ?? "") : "";

  function close() {
    setSheet(null);
    setError(null);
  }

  async function run(work: () => Promise<string>) {
    setError(null);
    try {
      const said = await work();
      feedback.success();
      announce(said);
      setNote("");
      setTrial("");
      setMakerId(null);
      close();
      refresh();
    } catch (e) {
      feedback.error();
      setError(dieErrorText(t, e));
    }
  }

  const errorBox = error ? (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink">
      {error}
    </Text>
  ) : null;

  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-5">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {t("dieRoom.maker.title")}
      </Text>

      {job ? (
        <View className="gap-3">
          <View className="gap-0.5">
            <Text className="font-sans-semibold text-base text-ink">{t("dieRoom.maker.job", { number: job.number })}</Text>
            <Text className="font-sans text-[15px] text-ink-muted">
              {[makerName, t(PURPOSE_KEY[job.purpose as Purpose] ?? "dieRoom.maker.trial"), format.day(job.sentAt)].filter(Boolean).join(", ")}
            </Text>
          </View>
          {allowed ? (
            <>
              <Button variant="secondary" label={t("dieRoom.maker.receive")} onPress={() => setSheet("receive")} />
              <Button variant="ghost" label={t("dieRoom.maker.cancel")} onPress={() => setSheet("cancel")} />
            </>
          ) : null}
        </View>
      ) : (
        <>
          <Text className="font-sans text-[15px] text-ink-muted">{status === "available" ? t("dieRoom.maker.noneBody") : t("dieRoom.maker.none")}</Text>
          {canSend ? <Button variant="secondary" label={t("dieRoom.maker.send")} onPress={() => setSheet("send")} /> : null}
        </>
      )}

      <Sheet visible={sheet === "send"} onClose={close} title={t("dieRoom.maker.sendTitle", { code })}>
        {makers.data === undefined ? (
          <LoadingBlock />
        ) : makers.data.length === 0 ? (
          <Text className="font-sans text-[15px] leading-6 text-ink-muted">{`${t("dieRoom.maker.noMakers")} ${t("native.dies.addMakerOnWeb")}`}</Text>
        ) : (
          <View accessibilityRole="radiogroup" accessibilityLabel={t("dieRoom.maker.pickMaker")} className="gap-2">
            <Text className="font-sans-medium text-sm text-ink">{t("dieRoom.maker.pickMaker")}</Text>
            {makers.data.map((m) => (
              <ChoiceRow key={m.id} label={m.name} detail={m.city ?? undefined} selected={makerId === m.id} onPress={() => setMakerId(m.id)} />
            ))}
          </View>
        )}
        <SegmentedControl<Purpose>
          label={t("dieRoom.maker.purpose")}
          options={(["trial", "correction", "repair"] as const).map((p) => ({ value: p, label: t(PURPOSE_KEY[p]) }))}
          value={purpose}
          onChange={setPurpose}
        />
        <Field label={t("common.notes")} value={note} onChangeText={setNote} maxLength={500} multiline />
        {errorBox}
        <Button
          size="lg"
          label={t("dieRoom.maker.send")}
          loading={send.isPending}
          loadingLabel={t("common.saving")}
          disabled={!makerId}
          onPress={() =>
            makerId
              ? void run(async () => {
                  const done = await send.mutateAsync({ dieInstanceId: copyId, dieMakerId: makerId, purpose, ...(note.trim() ? { note: note.trim() } : {}) });
                  return t("dieRoom.maker.sentToast", { number: done.number, code });
                })
              : undefined
          }
        />
      </Sheet>

      <Sheet visible={sheet === "receive"} onClose={close} title={job ? t("dieRoom.maker.receiveTitle", { number: job.number }) : t("dieRoom.maker.receive")}>
        {trialMilli != null ? (
          <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("dieRoom.maker.trialSet", { kg: milliKgText(trialMilli) })}</Text>
        ) : (
          <NumberInput
            label={t("dieRoom.card.trial")}
            unit={t("units.kgPer12ft")}
            hint={t("dieRoom.maker.trialHint")}
            value={trial}
            onChangeText={setTrial}
            error={trialInvalid ? t("dieRoom.band.kgInvalid") : null}
          />
        )}
        <Field label={t("common.notes")} value={note} onChangeText={setNote} maxLength={500} multiline />
        {errorBox}
        <Button
          size="lg"
          label={t("dieRoom.maker.receive")}
          loading={receive.isPending}
          loadingLabel={t("common.saving")}
          disabled={trialInvalid}
          onPress={() =>
            job
              ? void run(async () => {
                  await receive.mutateAsync({
                    id: job.id,
                    ...(note.trim() ? { note: note.trim() } : {}),
                    ...(trialMilli == null && trialMilliTyped != null ? { trialKgPer12ftMilli: trialMilliTyped } : {}),
                  });
                  return t("dieRoom.maker.receivedToast", { number: job.number, code });
                })
              : undefined
          }
        />
      </Sheet>

      <Sheet visible={sheet === "cancel"} onClose={close} title={job ? t("dieRoom.maker.cancelTitle", { number: job.number }) : t("dieRoom.maker.cancel")}>
        <Text className="font-sans text-[15px] leading-6 text-ink">{t("dieRoom.maker.cancelBody", { code })}</Text>
        {errorBox}
        <Button
          size="lg"
          variant="danger"
          label={t("dieRoom.maker.cancel")}
          loading={cancel.isPending}
          onPress={() =>
            job
              ? void run(async () => {
                  await cancel.mutateAsync({ id: job.id });
                  return t("dieRoom.maker.cancelled");
                })
              : undefined
          }
        />
        <Button variant="secondary" label={t("dieRoom.maker.keepJob")} onPress={close} />
      </Sheet>
    </View>
  );
}
