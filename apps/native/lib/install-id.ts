import * as SecureStore from "expo-secure-store";

import { randomId } from "./random-id";

/** SecureStore keys allow only `[\w.-]`. The id stays on this install; a reinstall makes a new one. */
export const INSTALL_ID_KEY = "orrn.install-id";

let cached: string | null = null;

/** This install's id, made on first use. `device.register` and `release.check` both send it. */
export function getInstallId(): string {
  if (cached) return cached;
  let stored: string | null = null;
  try {
    stored = SecureStore.getItem(INSTALL_ID_KEY);
  } catch {
    stored = null;
  }
  if (stored && stored.length >= 8) {
    cached = stored;
    return stored;
  }
  const made = randomId(16);
  cached = made;
  // A broken keychain only means a new id next launch.
  SecureStore.setItemAsync(INSTALL_ID_KEY, made).catch(() => {});
  return made;
}
