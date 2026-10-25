import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, View } from "react-native";

import { MessageScreen } from "@/components/message-screen";
import { Button } from "@/components/ui/button";
import { getInstallId } from "@/lib/install-id";
import { getBuildNumber } from "@/lib/native-build";
import {
  blockedKey,
  gateInputs,
  gateState,
  needsUpdate,
  releaseChannel,
  shouldStore,
  storedFrom,
  UNREADABLE_BUILD,
  type CheckAnswer,
} from "@/lib/release-gate";
import { readStoredCheck, storeCheck } from "@/lib/release-gate-store";
import { ReleaseStatusContext } from "@/lib/release-status";
import { useThemeColor } from "@/lib/theme";
import { useNow } from "@/lib/use-now";
import { trpc } from "@/utils/trpc";

/** How often the decision is recomputed while the app is open, and how often the server is asked again. */
const TICK_MS = 30_000;
const RECHECK_MS = 15 * 60_000;

function CheckingScreen() {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  return (
    <View className="flex-1 items-center justify-center bg-canvas" accessible accessibilityLabel={t("native.gate.checking")}>
      <ActivityIndicator color={ink} />
    </View>
  );
}

/**
 * The distribution gate (spec E7): before the tabs, `release.check` for this build. Open lets the app
 * in; Blocked is a full screen with no way past it. The build number is the installed binary's
 * (expo-application), never the update manifest's, so an OTA update cannot clear a block; a phone that
 * cannot read it is blocked. Offline, the last Open answer holds for 24 hours from when it arrived
 * (lib/release-gate.ts `gateState`): the decision is recomputed every 30 s and when the app returns to
 * the foreground, so a block appears when the grace runs out while the app stays open, and a failed
 * recheck is never treated as Open past the grace. A build that last checked Open opens at once on a
 * cold start and checks in the background. Outside the signed-in app (`active` false) it only renders its children.
 */
export function ReleaseGate({ active, children }: { active: boolean; children: ReactNode }) {
  const { t } = useT();
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const buildNumber = getBuildNumber();
  const channel = releaseChannel(Constants.expoConfig);
  const installId = getInstallId();
  const kept = useRef(readStoredCheck());
  const now = useNow(TICK_MS);
  const check = useQuery({
    ...trpc.release.check.queryOptions({ platform, channel, buildNumber: buildNumber ?? 0, installId }),
    enabled: active && buildNumber !== null,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: RECHECK_MS,
  });

  // Keep each new answer for a cold start, timed when it arrived. The same answer seen again (a remount) is not re-stamped.
  useEffect(() => {
    if (!check.data || buildNumber === null) return;
    if (!shouldStore(kept.current, check.data as CheckAnswer, buildNumber, check.dataUpdatedAt)) return;
    kept.current = storedFrom(check.data as CheckAnswer, buildNumber, check.dataUpdatedAt);
    storeCheck(kept.current);
  }, [check.data, check.dataUpdatedAt, buildNumber]);

  const decision = useMemo(() => {
    if (!active) return null;
    if (buildNumber === null) return UNREADABLE_BUILD;
    const data = (check.data as CheckAnswer | undefined) ?? null;
    const inputs = gateInputs({ data, dataUpdatedAt: check.dataUpdatedAt, stored: kept.current, buildNumber });
    // `isError` is the latest check: React Query keeps the old data after a failed refetch, but that is not an online answer.
    const online = data !== null && !check.isError;
    const d = gateState({ ...inputs, now, online });
    // While a check is on its way, a block that more time on the wire could clear waits behind the spinner.
    if (d.kind === "blocked" && check.isFetching && (data === null || d.reason === "grace_expired")) return null;
    return d;
  }, [active, buildNumber, check.data, check.dataUpdatedAt, check.isError, check.isFetching, now]);

  if (!active) return <>{children}</>;
  if (decision === null) return <CheckingScreen />;

  if (decision.kind === "blocked") {
    const apk = needsUpdate(decision.reason) && Platform.OS === "android" ? decision.apkUrl : null;
    return (
      <MessageScreen
        title={t("native.gate.blockedTitle")}
        body={`${t(blockedKey(decision.reason))}${decision.latestVersion ? ` ${t("native.gate.latest", { version: decision.latestVersion })}` : ""}`}
      >
        {apk ? <Button size="lg" label={t("native.gate.getLatest")} onPress={() => void Linking.openURL(apk).catch(() => {})} /> : null}
        <Button size="lg" variant={apk ? "secondary" : "primary"} label={t("native.checkAgain")} loading={check.isFetching} onPress={() => void check.refetch()} />
      </MessageScreen>
    );
  }

  return <ReleaseStatusContext value={decision}>{children}</ReleaseStatusContext>;
}
