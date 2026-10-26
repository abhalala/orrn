import type { MessageKey, Translate } from "@orrn/i18n";

type TrpcLike = { message?: unknown; data?: { code?: unknown; httpStatus?: unknown } | null };

function parts(error: unknown): { code: unknown; status: unknown; message: string } {
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  return {
    code: e.data?.code,
    status: e.data?.httpStatus,
    message: typeof e.message === "string" ? e.message : "",
  };
}

/** tRPC codes that mean the server failed, not that it refused (httpStatus 5xx). */
const SERVER_FAULTS = new Set([
  "INTERNAL_SERVER_ERROR",
  "NOT_IMPLEMENTED",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
]);

/**
 * The entry may or may not have been saved: no answer came back (network drop, Wi-Fi gone,
 * aborted), or the server answered with a fault (5xx: the handler threw after its batch, a gateway
 * gave up). Only a refusal (4xx) proves nothing was written. With a client request id (RP18) the
 * same values are safe to send again: the server returns the first entry if it was saved. Same rule
 * as the native writeFailureKind (T28).
 */
export function isUnknownOutcome(error: unknown): boolean {
  const { code, status } = parts(error);
  if (code === undefined || code === null) return true;
  if (typeof status === "number") return status >= 500;
  return typeof code === "string" && SERVER_FAULTS.has(code);
}

/**
 * Store refusals, matched on the server's English (routers/store.ts, lib/store.ts). Order matters:
 * the cancel refusals mention "retired" too. Anything unmatched becomes a plain localized refusal.
 */
const BAD_REQUEST: [RegExp, MessageKey][] = [
  [/^Only .+ in the store$/, "store.errors.short"],
  [/still has stock/, "store.errors.retireWithStock"],
  [/unit can no longer change/, "store.errors.unitLocked"],
  [/^Cannot cancel /, "store.errors.cancelDrawn"],
  [/^Store location .*reactivate it before cancelling/, "store.errors.cancelLocationRetired"],
  [/is retired; reactivate it before cancelling/, "store.errors.cancelItemRetired"],
  [/was already cancelled$/, "store.errors.alreadyCancelled"],
  [/ belongs to (a |another )/, "store.errors.sourceLocked"],
  [/ is retired$/, "store.errors.itemRetired"],
  [/ changed; open it again$/, "store.errors.itemChanged"],
  [/^The store changed/, "store.errors.storeChanged"],
  [/central store location/, "store.errors.noLocation"],
  [/More than one central store/, "store.errors.manyStores"],
  [/counted in whole numbers/, "store.form.qty.whole"],
  [/letters or digits/, "store.errors.nameInvalid"],
];

/** What to tell the person, as a message key. Server English never reaches the screen (ruling T21). */
export function storeErrorKey(error: unknown): MessageKey {
  const { code, message } = parts(error);
  if (code === undefined || code === null) return "errors.network";
  switch (code) {
    case "FORBIDDEN":
      return "errors.forbidden";
    case "UNAUTHORIZED":
      return "errors.sessionExpired";
    case "NOT_FOUND":
      return "store.errors.notFound";
    case "CONFLICT":
      if (/already (exists|has that name)/.test(message)) return "store.errors.duplicateName";
      if (/request id/.test(message)) return "store.errors.requestReused";
      return "errors.conflict";
    case "BAD_REQUEST":
      return BAD_REQUEST.find(([pattern]) => pattern.test(message))?.[1] ?? "store.errors.refused";
    default:
      return "errors.generic";
  }
}

/** `storeErrorKey` in the person's language. */
export function storeErrorText(t: Translate, error: unknown): string {
  return t(storeErrorKey(error));
}
