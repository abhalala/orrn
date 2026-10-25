import type { MessageKey, Translate } from "@orrn/i18n";
import { useCallback, useRef } from "react";

import { can, useMe, type Action, type Me } from "@/shared/lib/me";

import { joinErrorView, pressErrorView, type PressErrorOpts } from "./errors";

export { useCan, useCompanyTimeZone } from "@/features/dispatch/hooks";

export { billetsOnHandOf, gatesOf, isNetworkError } from "./errors";

/**
 * What to tell the person when a press write failed, as one string: the sentence in their language,
 * then (only for a refusal this build does not know) the server's text after a line break. Render
 * it with `<ErrorLines>`; a toast takes `pressErrorToast`.
 */
export function pressErrorText(t: Translate, error: unknown, fallback?: MessageKey, opts: Omit<PressErrorOpts, "fallback"> = {}): string {
  return joinErrorView(pressErrorView(t, error, { ...opts, ...(fallback ? { fallback } : {}) }));
}

/** The same as one line for a toast. */
export function pressErrorToast(t: Translate, error: unknown, fallback?: MessageKey): string {
  return pressErrorText(t, error, fallback).replace("\n", " ");
}

/**
 * One idempotency key per user action: the same key goes with every retry of that action (a retry
 * after a dropped response replays instead of repeating), and a new one after it succeeded.
 */
export function useActionKey() {
  const ref = useRef<string | null>(null);
  const get = useCallback(() => (ref.current ??= crypto.randomUUID()), []);
  const reset = useCallback(() => {
    ref.current = null;
  }, []);
  return { get, reset };
}

export function useHolds(): { run: boolean; close: boolean; queue: boolean; publish: boolean; reports: boolean } {
  const { data: me } = useMe();
  const has = (a: Action) => can(me, a);
  return { run: has("press.run"), close: has("press.close"), queue: has("press.queue"), publish: has("masters.publish"), reports: has("reports.read") };
}

/** Whether a plant role holds an action (to list the people who can be named on a run). */
export function roleCan(role: string, action: Action): boolean {
  return can({ company: { role }, isPlatformAdmin: false, platformRole: null } as unknown as Me, action);
}
