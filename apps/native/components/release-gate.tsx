import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, View } from "react-native";

import { MessageScreen } from "@/components/message-screen";
import { Button } from "@/components/ui/button";
import { getInstallId } from "@/lib/install-id";
import {
  blockedKey,
  decideRelease,
  nativeBuildNumber,
  needsUpdate,
  optimisticDecision,
  releaseChannel,
  storedFrom,
  type CheckAnswer,
} from "@/lib/release-gate";
import { readStoredCheck, storeCheck } from "@/lib/release-gate-store";
import { ReleaseStatusContext } from "@/lib/release-status";
import { useThemeColor } from "@/lib/theme";
import { trpc } from "@/utils/trpc";

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
 * in; Blocked is a full screen with no way past it (an OTA update cannot clear it, the gate reads the
 * native build number). Offline, the last answer holds for 24 hours (lib/release-gate.ts). A build that
 * last checked Open opens at once and checks in the background, so a cold start never waits for the
 * network; if that check says Blocked the screen takes over. Outside the signed-in app (`active` false)
 * it only renders its children.
 */
export function ReleaseGate({ active, children }: { active: boolean; children: ReactNode }) {
  const { t } = useT();
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const buildNumber = nativeBuildNumber(platform, Constants.expoConfig);
  const channel = releaseChannel(Constants.expoConfig);
  const installId = getInstallId();
  const [first] = useState(readStoredCheck);
  const check = useQuery({
    ...trpc.release.check.queryOptions({ platform, channel, buildNumber, installId }),
    enabled: active,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Keep the last answer for the offline rule.
  useEffect(() => {
    if (check.data) storeCheck(storedFrom(check.data as CheckAnswer, buildNumber, Date.now()));
  }, [check.data, check.dataUpdatedAt, buildNumber]);

  const decision = useMemo(() => {
    if (!active) return null;
    const now = Date.now();
    if (check.data) return decideRelease({ answer: check.data as CheckAnswer, last: null, now, buildNumber });
    if (check.isError) return decideRelease({ answer: null, last: readStoredCheck() ?? first, now, buildNumber });
    return optimisticDecision(first, now, buildNumber);
    // dataUpdatedAt / errorUpdatedAt change when an answer arrives; Date.now() is read then.
  }, [active, check.data, check.isError, check.dataUpdatedAt, check.errorUpdatedAt, first, buildNumber]);

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
