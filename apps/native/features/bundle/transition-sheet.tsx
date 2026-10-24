import { useT } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { renderScanMessage } from "@/features/scan/outcome";
import { transitionError } from "@/features/stock/format";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { writeFailureKind } from "@/lib/request-timeout";
import { saveErrorText } from "@/lib/save-error";
import { trpc } from "@/utils/trpc";

import type { BundleNotice } from "./notice";

const REASON_MAX = 500;

/**
 * Void or Restore with a reason, in a bottom sheet. Void needs a reason (the
 * audit trail for a bundle that leaves stock); Restore's is optional. The
 * server keeps the rule that only an in-stock bundle can be voided and only a
 * void one restored. A refusal means the bundle changed since the page loaded:
 * the sheet closes and says so. A save that did not answer is "unsure": the
 * bundle is re-read so the person can check, and nothing is retried for them.
 */
export function TransitionSheet({
  visible,
  onClose,
  bundleId,
  to,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  bundleId: string;
  to: "void" | "available";
  /** Called after the bundle may have changed; the screen refreshes and shows the notice. */
  onDone: (notice: BundleNotice) => void;
}) {
  const { t } = useT();
  const voiding = to === "void";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const transition = useMutation(trpc.bundle.transitionStatus.mutationOptions());

  useEffect(() => {
    if (visible) {
      setReason("");
      setError(null);
      setFailure(null);
    }
  }, [visible]);

  const submit = () => {
    const text = reason.trim();
    setFailure(null);
    if (voiding && !text) {
      const message = t("bundle.reasonRequired");
      setError(message);
      feedback.error();
      announce(message, { shownInLiveRegion: true });
      return;
    }
    setError(null);
    transition.mutate(
      { id: bundleId, toStatus: to, reason: text || null },
      {
        onSuccess: () => {
          const said = t(voiding ? "bundle.voided" : "bundle.restored");
          feedback.success();
          announce(said);
          onClose();
          onDone({ tone: "success", text: said });
        },
        onError: (err) => {
          feedback.error();
          const mapped = renderScanMessage(t, transitionError(err));
          const code = (err as { data?: { code?: unknown } } | null)?.data?.code;
          if (writeFailureKind(err) === "unsure") {
            // It may have gone through: show where the bundle is now and let the person check.
            const unsure = saveErrorText(t, err);
            setFailure(`${unsure.title}. ${unsure.body}`);
            onDone({ tone: "neutral", text: `${unsure.title}. ${unsure.body}` });
            return;
          }
          if (code === "BAD_REQUEST" || code === "CONFLICT") {
            // The bundle changed since the page loaded: say how, close, and show where it is now.
            announce(mapped);
            onClose();
            onDone({ tone: "error", text: mapped });
            return;
          }
          setFailure(code === "FORBIDDEN" ? mapped : saveErrorText(t, err).body);
        },
      },
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t(voiding ? "bundle.voidTitle" : "bundle.restoreTitle")}>
      <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t(voiding ? "bundle.voidBody" : "bundle.restoreBody")}</Text>
      {failure ? (
        <Text accessibilityLiveRegion="polite" className="font-sans-medium text-[15px] leading-6 text-destructive">
          {failure}
        </Text>
      ) : null}
      <Field
        label={voiding ? t("bundle.reason") : `${t("bundle.reason")} (${t("common.optional")})`}
        hint={t("bundle.reasonHint")}
        error={error}
        value={reason}
        onChangeText={(next) => {
          setReason(next);
          if (error) setError(null);
        }}
        maxLength={REASON_MAX}
        autoComplete="off"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Button
        size="lg"
        variant={voiding ? "danger" : "primary"}
        label={t(voiding ? "bundle.void" : "bundle.restore")}
        loading={transition.isPending}
        onPress={submit}
      />
    </Sheet>
  );
}
