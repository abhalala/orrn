import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Platform } from "react-native";

import { trpc } from "@/utils/trpc";

import { isDeviceRevoked } from "./device-revoked";
import { getInstallId } from "./install-id";
import { getAppVersion, getBuildNumber } from "./native-build";
import { appVersionLabel } from "./release-gate";
import { signOut } from "./sign-out";

/** Companies this launch has already registered the device with. */
const registered = new Set<string>();

/**
 * `device.register` on launch (spec E7): once per launch and plant, with this install's id, the OS and
 * `version (build)`. A failure other than "turned off" is ignored (the Devices tab just shows the phone
 * later). A turned-off install has had its session ended by the server; the phone signs out too, and the
 * release gate then blocks it.
 */
export function useDeviceRegister(companyId: string | null | undefined) {
  const register = useMutation(trpc.device.register.mutationOptions());
  useEffect(() => {
    if (!companyId || registered.has(companyId)) return;
    // The installed binary's build (not the update manifest's). Unreadable: the release gate blocks this phone anyway.
    const build = getBuildNumber();
    if (build === null) return;
    registered.add(companyId);
    const platform = Platform.OS === "ios" ? "ios" : "android";
    register.mutate(
      {
        installId: getInstallId(),
        platform,
        osVersion: String(Platform.Version),
        appVersion: appVersionLabel(getAppVersion(), build),
      },
      {
        onError: (error) => {
          if (isDeviceRevoked(error)) void signOut();
          // Anything else: try again on the next launch.
          else registered.delete(companyId);
        },
      },
    );
    // `register` is a stable mutation handle; the effect is about the plant, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);
}
