import type { MessageKey, Translate } from "@orrn/i18n";
import { useCallback, useRef } from "react";

import { actionErrorText } from "@/features/dispatch/errors";
import { can, useMe, type Action, type Me } from "@/shared/lib/me";

export { useCan, useCompanyTimeZone } from "@/features/dispatch/hooks";

type TrpcLike = { message?: unknown; data?: { code?: unknown; meta?: { gates?: unknown } } | null };
const asTrpc = (error: unknown): TrpcLike => (error && typeof error === "object" ? (error as TrpcLike) : {});

/** The gate codes a refused `press.runs.close` carries (server `TRPCMetaError`), or null. */
export function gatesOf(error: unknown): string[] | null {
  const gates = asTrpc(error).data?.meta?.gates;
  return Array.isArray(gates) && gates.every((g) => typeof g === "string") ? (gates as string[]) : null;
}

/** True when the request never reached the server (offline, dropped): keep the form, offer Try again. */
export function isNetworkError(error: unknown): boolean {
  return asTrpc(error).data?.code === undefined;
}

/**
 * What to tell the person when a press write failed. The server's press sentences are plain and
 * specific ("Another run is running on this press; stop it first"), so a BAD_REQUEST / CONFLICT
 * shows them; a dropped connection says the entries are still here.
 */
export function pressErrorText(t: Translate, error: unknown, fallback?: MessageKey): string {
  const e = asTrpc(error);
  const code = e.data?.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === undefined) return t("press.console.saveFailed");
  if ((code === "BAD_REQUEST" || code === "CONFLICT") && message && !message.startsWith("[") && message.length < 240) return message;
  if (fallback && code !== "FORBIDDEN" && code !== "UNAUTHORIZED") return t(fallback);
  return actionErrorText(t, error);
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
