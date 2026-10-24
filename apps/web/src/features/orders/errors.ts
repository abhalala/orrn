import type { Translate } from "@orrn/i18n";

import { actionErrorText } from "@/features/dispatch/errors";

import { blockersFromMessage, blockerText, poRepeatFromMessage } from "./view";

type TrpcLike = { message?: unknown; data?: { code?: unknown } | null };

function parts(error: unknown): { code: string | undefined; message: string } {
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  return { code: typeof e.data?.code === "string" ? e.data.code : undefined, message: typeof e.message === "string" ? e.message : "" };
}

/**
 * What to tell someone when an orders write was refused: lines, in their language where the
 * refusal is one we know (confirm blockers, a repeated PO), the server's own plain sentence where
 * it names the thing ("This die belongs to X", "only 12.000 kg is left to plan"), and the shared
 * network / permission wording otherwise.
 */
export function orderErrorLines(t: Translate, error: unknown): string[] {
  const { code, message } = parts(error);
  const blockers = blockersFromMessage(message);
  if (blockers.length > 0) return blockers.map((b) => blockerText(b, t));
  const repeat = poRepeatFromMessage(message);
  if (repeat) return [t("orders.poRepeat", { po: repeat.po, code: repeat.code })];
  if ((code === "BAD_REQUEST" || code === "CONFLICT" || code === "FORBIDDEN" || code === "NOT_FOUND") && message && !message.startsWith("[")) {
    // A zod failure arrives as JSON text; anything else is a sentence meant to be read.
    return [message];
  }
  return [actionErrorText(t, error)];
}

export function orderErrorText(t: Translate, error: unknown): string {
  return orderErrorLines(t, error).join(" ");
}
