import type { MessageKey } from "@orrn/i18n";
import { WebAuthnAbortService } from "@simplewebauthn/browser";

import { authClient } from "@/shared/lib/auth-client";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { addPasskeyWith, defaultPasskeyName } from "./passkey-add";

/**
 * Adds a passkey for the signed-in person on this device, named after the device, then refreshes what the
 * screens read (`auth.me`, `auth.signInMethods`). Null when it was added, else the message key to show.
 */
export async function addPasskeyHere(): Promise<MessageKey | null> {
  const failure = await addPasskeyWith(
    (opts) => authClient.passkey.addPasskey(opts),
    () => WebAuthnAbortService.cancelCeremony(),
    defaultPasskeyName(navigator.userAgent),
  );
  if (!failure) {
    await Promise.all([
      queryClient.invalidateQueries(trpc.auth.me.queryFilter()),
      queryClient.invalidateQueries(trpc.auth.signInMethods.queryFilter()),
    ]);
  }
  return failure;
}
