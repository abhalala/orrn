import { bundleTone } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useFormat } from "@/lib/use-format";

import type { TimelineEntry, TimelineKind } from "./timeline";

const TITLE: Record<TimelineKind, MessageKey> = {
  packed: "bundle.historyPacked",
  imported: "bundle.historyImported",
  held: "bundle.historyHeld",
  released: "bundle.historyReleased",
  dispatched: "bundle.historyDispatched",
  voided: "bundle.historyVoided",
  restored: "bundle.historyRestored",
  changed: "bundle.historyChanged",
};

/** Status colour of the dot (static class names for Tailwind). */
const DOT = {
  green: "bg-tone-green",
  blue: "bg-tone-blue",
  amber: "bg-tone-amber",
  red: "bg-tone-red",
  neutral: "bg-tone-neutral-ink",
} as const;

/**
 * The bundle's history, newest first: what happened in floor words, when, the
 * reason someone typed, and a link to the dispatch for holds and dispatches.
 * The dot's colour repeats the status the event led to; the words carry the meaning.
 */
export function BundleTimeline({ entries, activeDispatch }: { entries: readonly TimelineEntry[]; activeDispatch: { id: string; code: string } | null }) {
  const { t } = useT();
  const router = useRouter();
  const fmt = useFormat();
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-display-bold text-[22px] text-ink">
        {t("bundle.history")}
      </Text>
      <View className="rounded-card border border-hairline bg-surface">
        {entries.map((e, i) => {
          const code = e.dispatchId && activeDispatch?.id === e.dispatchId ? activeDispatch.code : null;
          const title = t(TITLE[e.kind], { status: t(`status.bundle.${e.status}`) });
          const when = [fmt.day(e.at), fmt.time(e.at)].filter(Boolean).join(", ");
          const showLink = e.dispatchId && (e.kind === "held" || e.kind === "dispatched");
          return (
            <View
              key={e.id}
              accessible={!showLink}
              accessibilityLabel={showLink ? undefined : [title, when, e.note ? t("bundle.reasonLine", { reason: e.note }) : null].filter(Boolean).join(", ")}
              className={cn("flex-row gap-3 px-4 py-3.5", i > 0 && "border-t border-hairline")}
            >
              <View importantForAccessibility="no-hide-descendants" className={cn("mt-2 h-2.5 w-2.5 rounded-full", DOT[bundleTone(e.status)])} />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="font-sans-semibold text-[15px] leading-6 text-ink">{title}</Text>
                <Text className="font-sans text-[13px] text-ink-muted">{when}</Text>
                {e.note ? <Text className="font-sans text-sm text-ink">{t("bundle.reasonLine", { reason: e.note })}</Text> : null}
                {showLink ? (
                  <PressableScale
                    accessibilityRole="link"
                    accessibilityLabel={code ? t("bundle.openDispatch", { code }) : t("bundle.openDispatchPlain")}
                    onPress={() => router.push(`/dispatch/${encodeURIComponent(e.dispatchId!)}`)}
                    className="min-h-11 justify-center self-start"
                  >
                    <Text className="font-sans-semibold text-sm text-ink underline">{code ? t("bundle.openDispatch", { code }) : t("bundle.openDispatchPlain")}</Text>
                  </PressableScale>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
