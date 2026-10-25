import { splitPastedSerials } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { saveErrorText } from "@/lib/save-error";

import { renderScanMessage, unavailableMessage, type AddBundlesReport } from "../scan/outcome";
import type { ResolveHit } from "../scan/scan-flow";
import { addPastedSerials, emptyReport, resolvePasted } from "./paste";

type Result = { report: AddBundlesReport; ambiguous: string[]; unsent: string[]; error: string | null };

export type PasteSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** One chunk of at most 100 serials to `dispatch.scan` (with a replay key per chunk). */
  send: (serials: string[]) => Promise<AddBundlesReport>;
  /** `resolve.byCode`, for old month-only numbers. */
  resolve: (code: string) => Promise<ResolveHit>;
  /** At least one bundle was added: the dispatch should be re-read. */
  onAdded: () => void;
};

/**
 * Paste serials: one per line or separated by commas or spaces. Old
 * month-only numbers are resolved first. The result lists, for each kind,
 * the count and the serials, with the reason a bundle could not go on in the
 * floor wording. A chunk that fails stops the run and says which serials were
 * never sent, so nothing is retried blindly.
 */
export function PasteSheet({ visible, onClose, send, resolve, onAdded }: PasteSheetProps) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const serials = useMemo(() => splitPastedSerials(text), [text]);

  const close = () => {
    if (busy) return;
    setResult(null);
    setText("");
    onClose();
  };

  const submit = async () => {
    if (serials.length === 0 || busy) return;
    setBusy(true);
    try {
      let resolved;
      try {
        resolved = await resolvePasted(serials, resolve);
      } catch {
        // Nothing was sent yet: the person can paste again as it is.
        feedback.error();
        setResult({ report: emptyReport(), ambiguous: [], unsent: serials, error: t("errors.network") });
        return;
      }
      const outcome = resolved.serials.length > 0 ? await addPastedSerials(resolved.serials, send) : { report: emptyReport(), failedAt: null as number | null, error: undefined };
      const report = { ...outcome.report, notFound: [...outcome.report.notFound, ...resolved.notFound] };
      const unsent = outcome.failedAt === null ? [] : resolved.serials.slice(outcome.failedAt);
      const error = outcome.failedAt === null ? null : saveErrorText(t, outcome.error).body;
      if (report.added.length > 0) onAdded();
      const clean = !error && resolved.ambiguous.length === 0 && report.notFound.length === 0 && report.unavailable.length === 0;
      if (clean) feedback.success();
      else feedback.error();
      announce([t("dispatch.paste.added", { count: report.added.length }), error].filter(Boolean).join(". "), { shownInLiveRegion: false });
      setResult({ report, ambiguous: resolved.ambiguous, unsent, error });
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setText(result?.unsent.join("\n") ?? "");
    setResult(null);
  };

  return (
    <Sheet visible={visible} onClose={close} title={t("dispatch.paste.title")}>
      {result ? (
        <ReportView result={result} />
      ) : (
        <>
          <Field
            label={t("dispatch.paste.label")}
            hint={t("dispatch.paste.hint")}
            value={text}
            onChangeText={setText}
            mono
            multiline
            autoCapitalize="characters"
            autoCorrect={false}
            textAlignVertical="top"
            inputClassName="min-h-40 py-3"
          />
          {serials.length > 0 ? <Text className="font-sans-medium text-[15px] text-ink-muted">{t("native.dispatch.pasteReady", { count: serials.length })}</Text> : null}
        </>
      )}
      {result ? (
        <>
          <Button size="lg" label={t("common.done")} onPress={close} />
          {result.unsent.length > 0 ? <Button variant="secondary" label={t("native.dispatch.pasteAgain")} onPress={again} /> : null}
        </>
      ) : (
        <Button size="lg" label={t("dispatch.paste.submit")} loading={busy} loadingLabel={t("native.dispatch.pasteChecking")} disabled={serials.length === 0} onPress={() => void submit()} />
      )}
    </Sheet>
  );
}

function ReportView({ result }: { result: Result }) {
  const { t } = useT();
  const { report } = result;
  return (
    <View accessibilityLiveRegion="polite" className="gap-4">
      {result.error ? (
        <View className="gap-1 rounded-card bg-tone-red-tint p-3">
          <Text className="font-sans-semibold text-[15px] text-tone-red-ink">{t("native.dispatch.pastePartial", { count: result.unsent.length })}</Text>
          <Text className="font-sans text-[15px] leading-6 text-tone-red-ink">{result.error}</Text>
        </View>
      ) : null}
      <ReportGroup tone="green" label={t("dispatch.paste.added", { count: report.added.length })} serials={report.added} />
      <ReportGroup tone="neutral" label={t("dispatch.paste.already", { count: report.alreadyInDispatch.length })} serials={report.alreadyInDispatch} />
      <ReportGroup tone="amber" label={t("dispatch.paste.notFound", { count: report.notFound.length })} serials={report.notFound} />
      {result.ambiguous.length > 0 ? (
        <Text className="font-sans text-[15px] leading-6 text-ink">{t("native.dispatch.pasteAmbiguous", { serials: result.ambiguous.join(", ") })}</Text>
      ) : null}
      {report.unavailable.length > 0 ? (
        <View className="gap-2">
          <Chip tone="red" label={t("dispatch.paste.unavailable", { count: report.unavailable.length })} />
          {report.unavailable.map((row) => (
            <View key={row.serial} accessible className="flex-row flex-wrap items-baseline gap-x-2">
              <Text className="font-mono-semibold text-[15px] text-ink">{row.serial}</Text>
              <Text className="min-w-0 shrink font-sans text-[15px] text-ink-muted">{renderScanMessage(t, unavailableMessage(row))}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ReportGroup({ tone, label, serials }: { tone: "green" | "neutral" | "amber"; label: string; serials: string[] }) {
  if (serials.length === 0) return null;
  return (
    <View className="gap-1.5">
      <Chip tone={tone} label={label} />
      <Text className="font-mono text-sm leading-5 text-ink-muted">{serials.join(", ")}</Text>
    </View>
  );
}
