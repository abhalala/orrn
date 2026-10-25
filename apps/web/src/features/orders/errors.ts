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
    // A zod failure arrives as JSON text; anything else is a sentence meant to be read. The ones a
    // line edit or a plan meets are worded here; the rest are marked as the server's (in Hindi
    // "सर्वर का जवाब: …"), never passed off as the screen's own words.
    const known = knownRefusal(t, message);
    if (known) return [known];
    return [t("orders.serverSaid", { message })];
  }
  return [actionErrorText(t, error)];
}

export function orderErrorText(t: Translate, error: unknown): string {
  return orderErrorLines(t, error).join(" ");
}

const RELEASED_PLAN = /^Line ([\d, ]+) is on a released press plan/;
const BELOW_DISPATCHED = /^([\d,.]+) kg is already dispatched on line (\d+), more than the new ([\d,.]+) kg/;
const OWNED = /^This die belongs to (.+)$/;

// FP-OP-17 hold / release refusals (orders.hold, orders.release), in the reader's language.
const HOLD_REFUSALS: [RegExp, (t: Translate, m: RegExpExecArray) => string][] = [
  [/^(\S+) is on dispatch (.*); take it off the dispatch first$/, (t, m) => t("orders.hold.refusal.on_dispatch", { serial: m[1]!, code: m[2]!.trim() })],
  [/^(\S+) is already held for (\S+) line (\d+) \((.+)\)\. Release it first\.$/, (t, m) => t("orders.hold.refusal.held_elsewhere", { serial: m[1]!, order: m[2]!, line: m[3]!, customer: m[4]! })],
  [/^(\S+) is already held for another order line\. Release it first\.$/, (t, m) => t("orders.hold.refusal.held_elsewhere_bare", { serial: m[1]! })],
  [/^(\S+) is on (.+) line (\d*); move it with Reallocate instead$/, (t, m) => t("orders.hold.refusal.other_line", { serial: m[1]!, order: m[2]!, line: m[3]! })],
  [/^(\S+) is a different die from that line$/, (t, m) => t("orders.hold.refusal.die_mismatch", { serial: m[1]! })],
  [/^(\S+) is waiting on a reallocation approval$/, (t, m) => t("orders.hold.refusal.pending", { serial: m[1]! })],
  [/^(\S+) is (\w+); only bundles in the yard can be held$/, (t, m) => t("orders.hold.refusal.not_available", { serial: m[1]!, status: m[2]! })],
  [/^(\S+) is (\w+); hold stock for an open order$/, (t, m) => t("orders.hold.refusal.line_closed", { order: m[1]!, status: m[2]! })],
  [/^(.+) (?:is|are) not held for (\S+) line (\d+)$/, (t, m) => t("orders.hold.refusal.not_held", { serials: m[1]!, order: m[2]!, line: m[3]! })],
  [/^A bundle or the order changed meanwhile\. Reload and try again\.$/, (t) => t("orders.hold.refusal.changed")],
];

/** A hold or release refusal in the reader's language, or null when the sentence is not one of them. */
export function holdRefusalText(t: Translate, message: string): string | null {
  for (const [re, text] of HOLD_REFUSALS) {
    const m = re.exec(message);
    if (m) return text(t, m);
  }
  return null;
}

function knownRefusal(t: Translate, message: string): string | null {
  const hold = holdRefusalText(t, message);
  if (hold) return hold;
  const released = RELEASED_PLAN.exec(message);
  if (released) return t("orders.edit.releasedPlan", { lines: released[1]!.trim() });
  const below = BELOW_DISPATCHED.exec(message);
  if (below) return t("orders.edit.belowDispatched", { dispatched: below[1]!, line: below[2]!, kg: below[3]! });
  const owned = OWNED.exec(message);
  if (owned) return t("orders.ownedBy", { name: owned[1]! });
  return null;
}
