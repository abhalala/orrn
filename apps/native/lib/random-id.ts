import { getRandomBytes, randomUUID } from "expo-crypto";

import { hexId } from "./hex-id";

/**
 * A random hex id for replay keys (`clientRequestId`). The bytes come from the OS secure generator
 * through `expo-crypto`; there is no weak fallback, because a predictable id could collide across phones.
 */
export function randomId(bytes = 16): string {
  return hexId(bytes, getRandomBytes);
}

/** A new install id (a v4 UUID from the OS secure generator). It is the key a device revoke works on. */
export function newInstallId(): string {
  return randomUUID();
}
