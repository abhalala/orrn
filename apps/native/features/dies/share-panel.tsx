import { useT } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Share, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { replayKey, sendOnce, type ReplayAttempt } from "@/lib/replay-key";
import { trpc } from "@/utils/trpc";

import { dieErrorText } from "./errors";
import { shareMessage, SHARE_DAYS } from "./share-model";
import { useRefreshDieRoom } from "./use-die-write";

/**
 * Share the section's press drawing from the phone (FP-DR-20): one tap makes a link that stays open
 * for 7 days (for the owner when the die has one) and opens the system share sheet with it. The link is
 * also shown, selectable, in case the sheet is dismissed. Revoking and the list of links are on the web.
 */
export function SharePanel({ sectionId, section, ownerCustomerId }: { sectionId: string; section: string; ownerCustomerId: string | null }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation(trpc.die.share.create.mutationOptions());
  const attempt = useRef<ReplayAttempt>(null);

  async function share() {
    setError(null);
    try {
      // One replay key per request (final fixes 5, M4): a reply lost on Wi-Fi and a second tap make no second link.
      const body = { sectionId, days: SHARE_DAYS, ...(ownerCustomerId ? { customerId: ownerCustomerId } : {}) };
      const next = replayKey(attempt.current, body, randomId);
      attempt.current = next.attempt;
      const made = await sendOnce((clientMutationId) => create.mutateAsync({ ...body, clientMutationId }), next.id);
      attempt.current = null;
      setLink(made.url);
      feedback.success();
      announce(t("dieRoom.share.sent", { section }));
      refresh();
      // The system share sheet; dismissing it is not an error, the link stays on screen.
      await Share.share({ message: shareMessage(t("dieRoom.share.message", { section, link: made.url })), url: made.url }).catch(() => undefined);
    } catch (e) {
      feedback.error();
      setError(dieErrorText(t, e));
    }
  }

  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-5">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {t("dieRoom.share.title", { section })}
      </Text>
      <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("dieRoom.share.nativeHint")}</Text>
      <Button label={t("dieRoom.share.button")} accessibilityHint={t("dieRoom.share.nativeHint")} loading={create.isPending} loadingLabel={t("common.saving")} onPress={() => void share()} />
      {link ? (
        <Text selectable accessibilityLabel={t("dieRoom.share.linkLabel")} className="font-mono text-[13px] leading-5 text-ink">
          {link}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
