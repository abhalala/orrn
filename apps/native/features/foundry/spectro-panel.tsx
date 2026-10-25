import { SPECTRO_ELEMENTS, spectroCheck, type SpectroElementKey, type SpectroLimit, type SpectroVerdict } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Linking, Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Sheet } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { webUrl } from "@/lib/web-url";
import { replayKey, sendOnce, type ReplayAttempt } from "@/lib/replay-key";
import { writeFailureKind } from "@/lib/request-timeout";
import { queryClient, trpc } from "@/utils/trpc";

import { CameraSheet } from "./camera-sheet";
import { foundryError } from "./errors";
import { ELEMENT_LABEL, readingTone, spectroInput, spectroRows, verdictTone, ppmPct } from "./foundry-model";
import type { SpectroResult } from "./types";
import { ErrorLine, Note } from "./ui";

const VERDICT_KEY: Record<SpectroVerdict, MessageKey> = {
  pass: "foundry.spectro.verdict.pass",
  fail: "foundry.spectro.verdict.fail",
  incomplete: "foundry.spectro.verdict.incomplete",
};
const SOURCE_KEY: Record<string, MessageKey> = {
  file: "foundry.spectro.source.file",
  typed: "foundry.spectro.source.typed",
  import: "foundry.spectro.source.import",
};

function refresh() {
  void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
  void queryClient.invalidateQueries({ queryKey: trpc.foundry.melts.pathKey() });
  void queryClient.invalidateQueries({ queryKey: trpc.foundry.spectroInbox.pathKey() });
}

/** A stored result as a short table of the nine elements against the alloy's limits. */
function ResultTable({ result, limits }: { result: Pick<SpectroResult, "values" | "verdict">; limits: readonly SpectroLimit[] }) {
  const { t } = useT();
  const judged = spectroRows(result.values, limits);
  if (!judged) return <Text className="font-sans text-sm text-ink-muted">{t("foundry.spectro.noTable")}</Text>;
  const words = { max: t("foundry.spectro.max"), min: t("foundry.spectro.min"), to: t("foundry.spectro.to") };
  return (
    <View className="gap-1">
      {judged.rows.map((r) => {
        const l = r.limit;
        const limit =
          !l || (l.minPpm == null && l.maxPpm == null)
            ? ""
            : l.minPpm != null && l.maxPpm != null
              ? `${(l.minPpm / 10_000).toFixed(2)} ${words.to} ${(l.maxPpm / 10_000).toFixed(2)}`
              : l.maxPpm != null
                ? `${words.max} ${(l.maxPpm / 10_000).toFixed(2)}`
                : `${words.min} ${(l.minPpm! / 10_000).toFixed(2)}`;
        return (
          <View key={r.element} className="min-h-9 flex-row items-center gap-3 border-b border-hairline py-1">
            <Text className="w-9 font-mono-semibold text-base text-ink">{ELEMENT_LABEL[r.element]}</Text>
            <Text className="w-[72px] text-right font-mono text-base text-ink">{ppmPct(r.ppm)}</Text>
            <Text className="min-w-0 flex-1 font-mono text-[13px] text-ink-muted">{limit}</Text>
            {r.reading === "missing" ? (
              <Text className="font-sans text-sm text-ink-muted">-</Text>
            ) : r.reading === "no_limit" ? (
              <Text className="font-sans text-xs text-ink-muted">{t("foundry.spectro.noLimit")}</Text>
            ) : (
              <Chip tone={readingTone(r.reading)} label={r.reading === "pass" ? t("foundry.spectro.readingPass") : t("foundry.spectro.readingFail")} />
            )}
            {r.source === "balance" ? <Text className="font-sans text-xs text-ink-muted">{t("foundry.spectro.alBalance")}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function ResultCard({ result, limits, webPath }: { result: SpectroResult; limits: readonly SpectroLimit[]; webPath?: string }) {
  const { t } = useT();
  const voided = result.voidedAt != null;
  return (
    <View className={voided ? "gap-2 rounded-card border border-hairline bg-surface p-3 opacity-60" : "gap-2 rounded-card border border-hairline bg-surface p-3"}>
      <View className="flex-row flex-wrap items-center gap-2">
        {result.verdict ? <Chip tone={verdictTone(result.verdict as SpectroVerdict)} label={t(VERDICT_KEY[result.verdict as SpectroVerdict])} /> : null}
        <Chip tone="neutral" label={t(SOURCE_KEY[result.source] ?? SOURCE_KEY.file!)} />
        {voided ? <Chip tone="red" label={t("foundry.spectro.void")} /> : null}
      </View>
      {result.fileName ? <Text className="font-mono text-[13px] text-ink-muted">{result.fileName}</Text> : null}
      {/* FP-FD-11: the stored file opens on the web (the phone does not render PDFs or keep the bytes). */}
      {result.hasFile && webPath ? (
        <Button variant="secondary" label={t("foundry.spectro.openOnWeb")} onPress={() => void Linking.openURL(webUrl(webPath)).catch(() => {})} />
      ) : null}
      {result.entryReason ? <Text className="font-sans text-sm text-ink-muted">{t("foundry.spectro.typedBecause", { reason: result.entryReason })}</Text> : null}
      {Object.keys(result.values ?? {}).length > 0 ? <ResultTable result={result} limits={limits} /> : null}
    </View>
  );
}

/**
 * The spectro part of a melt: its results against the alloy's limits and two ways in, a photo of the
 * printout (camera) or the numbers typed with the reason. Both need the saved draft. A repeated photo is
 * guarded by the button waiting for the answer; typed numbers carry a replay key.
 */
export function SpectroPanel({ meltId, results, limits, alloyCode, draft, readOnly = false, webPath }: { meltId: string | null; results: readonly SpectroResult[]; limits: readonly SpectroLimit[]; alloyCode: string; draft: boolean; readOnly?: boolean; webPath?: string }) {
  const { t } = useT();
  const attach = useMutation(trpc.foundry.spectro.attach.mutationOptions());
  const [camera, setCamera] = useState(false);
  const [typing, setTyping] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const [added, setAdded] = useState(false);

  const onPhoto = async (base64: string) => {
    if (!meltId) return;
    setCamera(false);
    setProblem(null);
    try {
      await attach.mutateAsync({ meltId, fileName: `spectro-${Date.now()}.jpg`, mime: "image/jpeg", base64, values: {} });
      feedback.success();
      setAdded(true);
      announce(t("foundry.spectro.attached"));
      refresh();
    } catch (error) {
      feedback.error();
      setProblem(error);
      announce(foundryError(t, error));
      // An unsure answer may have attached it: look at the list before sending the photo again.
      if (writeFailureKind(error) === "unsure") refresh();
    }
  };

  const live = results.filter((r) => !r.voidedAt);
  return (
    <View className="gap-3">
      <Text className="font-sans text-sm text-ink-muted">{t("foundry.spectro.hint", { alloy: alloyCode })}</Text>
      {!meltId && !readOnly ? <Note tone="amber">{t("foundry.spectro.saveFirst")}</Note> : null}
      {readOnly ? null : (
        <Can do="cast.enter">
          <Button variant="secondary" size="lg" label={t("foundry.spectro.attachFile")} disabled={!meltId} loading={attach.isPending} onPress={() => setCamera(true)} />
        </Can>
      )}
      {draft && !readOnly ? (
        <Can do="melt.enter">
          <Button variant="secondary" size="lg" label={t("foundry.spectro.type")} disabled={!meltId} onPress={() => setTyping(true)} />
        </Can>
      ) : null}
      <ErrorLine error={problem} />
      {results.length === 0 ? <Text className="font-sans-medium text-[15px] text-ink">{t("foundry.spectro.noneYet")}</Text> : null}
      {[...results].reverse().map((r) => (
        <ResultCard key={r.id} result={r} limits={limits} webPath={webPath} />
      ))}
      {live.length === 0 && results.length > 0 ? <Note tone="amber">{t("foundry.spectro.allVoid")}</Note> : null}
      {added ? <Text accessibilityLiveRegion="polite" className="font-sans-medium text-sm text-tone-green-ink">{t("foundry.spectro.attached")}</Text> : null}
      <CameraSheet visible={camera} onClose={() => setCamera(false)} onCaptured={(b) => void onPhoto(b)} />
      {meltId ? <TypeSheet meltId={meltId} limits={limits} visible={typing} onClose={() => setTyping(false)} onAdded={() => setAdded(true)} /> : null}
    </View>
  );
}

function TypeSheet({ meltId, limits, visible, onClose, onAdded }: { meltId: string; limits: readonly SpectroLimit[]; visible: boolean; onClose: () => void; onAdded: () => void }) {
  const { t } = useT();
  const enter = useMutation(trpc.foundry.spectro.enter.mutationOptions());
  const [texts, setTexts] = useState<Partial<Record<SpectroElementKey, string>>>({});
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const attempt = useRef<ReplayAttempt>(null);
  const parsed = spectroInput(texts);
  const preview = (() => {
    if (!parsed.ok) return null;
    try {
      return spectroCheck(parsed.valuesPpm, limits).verdict;
    } catch {
      return null;
    }
  })();

  const done = () => {
    setTexts({});
    setReason("");
    setTried(false);
    setProblem(null);
    onClose();
  };

  const submit = async () => {
    setTried(true);
    if (!parsed.ok || !reason.trim()) return;
    setProblem(null);
    try {
      const body = { meltId, valuesPpm: parsed.valuesPpm, entryReason: reason.trim() };
      const next = replayKey(attempt.current, body, randomId);
      attempt.current = next.attempt;
      await sendOnce((clientRequestId) => enter.mutateAsync({ ...body, clientRequestId }), next.id);
      attempt.current = null;
      feedback.success();
      announce(t("foundry.spectro.attached"));
      onAdded();
      refresh();
      done();
    } catch (error) {
      feedback.error();
      setProblem(error);
      announce(foundryError(t, error));
      if (writeFailureKind(error) === "unsure") refresh();
    }
  };

  return (
    <Sheet visible={visible} onClose={done} title={t("foundry.spectro.typeTitle")}>
      <Text className="font-sans text-sm text-ink-muted">{t("foundry.spectro.typeHint")}</Text>
      <View className="flex-row flex-wrap gap-3">
        {SPECTRO_ELEMENTS.map((el) => (
          <NumberInput
            key={el}
            className="min-w-[30%] flex-1"
            label={`${ELEMENT_LABEL[el]} %`}
            value={texts[el] ?? ""}
            onChangeText={(v) => setTexts((s) => ({ ...s, [el]: v }))}
            error={tried && !parsed.ok && parsed.reason === "invalid" && parsed.element === el ? t("foundry.spectro.badNumber") : null}
          />
        ))}
      </View>
      {tried && !parsed.ok && parsed.reason === "none" ? <Note tone="red">{t("foundry.spectro.enterOne")}</Note> : null}
      {tried && !parsed.ok && parsed.reason === "over" ? <Note tone="red">{t("foundry.spectro.overMillion")}</Note> : null}
      {preview ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="font-sans text-sm text-ink">{t("foundry.spectro.previewIs")}</Text>
          <Chip tone={verdictTone(preview)} label={t(VERDICT_KEY[preview])} />
        </View>
      ) : null}
      <Field label={t("foundry.spectro.typeReason")} hint={t("foundry.spectro.typeReasonHint")} value={reason} onChangeText={setReason} maxLength={500} error={tried && !reason.trim() ? t("foundry.spectro.reasonRequired") : null} />
      <ErrorLine error={problem} />
      <Button size="lg" label={t("foundry.spectro.typeConfirm")} loading={enter.isPending} onPress={() => void submit()} />
    </Sheet>
  );
}
