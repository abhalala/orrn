import * as SecureStore from "expo-secure-store";

import { parseStored, type StoredCheck } from "./release-gate";

export const RELEASE_CHECK_KEY = "orrn.release-check";

export function readStoredCheck(): StoredCheck | null {
  try {
    return parseStored(SecureStore.getItem(RELEASE_CHECK_KEY));
  } catch {
    return null;
  }
}

export function storeCheck(check: StoredCheck): void {
  SecureStore.setItemAsync(RELEASE_CHECK_KEY, JSON.stringify(check)).catch(() => {});
}
