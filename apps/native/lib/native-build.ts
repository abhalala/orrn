import * as Application from "expo-application";

import { installedBuildNumber } from "./release-gate";

/** The installed binary's build number (iOS CFBundleVersion, Android versionCode), or null when unreadable. See `installedBuildNumber`. */
export function getBuildNumber(): number | null {
  try {
    return installedBuildNumber(Application.nativeBuildVersion);
  } catch {
    return null;
  }
}

/** The installed binary's version name (`1.0.0`), or null when unreadable. */
export function getAppVersion(): string | null {
  try {
    return Application.nativeApplicationVersion ?? null;
  } catch {
    return null;
  }
}
