/**
 * What a refused self-service write says on the phone. The leave sentences are the server's (`lib/hr/leave.ts`,
 * `routers/hrMore.ts`); each is matched here and said from `native.hr.refusal.*` in the person's language. A write that never
 * answered says "not sure it saved"; anything else unknown falls to the shared `serverRefusal`. Never show `error.message`.
 */
import type { MessageKey, Translate } from "@orrn/i18n";

import { serverRefusal } from "@/lib/server-refusal";
import { writeFailureKind } from "@/lib/request-timeout";

type Entry = { re: RegExp; key: MessageKey; vars?: (m: RegExpExecArray) => Record<string, string | number> };

export const LEAVE_REFUSALS: readonly Entry[] = [
  { re: /^A leave on these days is already asked or approved/, key: "native.hr.refusal.overlap" },
  { re: /^Only a waiting (or approved )?leave can be cancelled/, key: "native.hr.refusal.notWaiting" },
  { re: /^Those days are all holidays or weekly offs/, key: "native.hr.refusal.allOff" },
  { re: /^The last day is before the first/, key: "native.hr.refusal.badRange" },
  { re: /^Split a leave that runs into the next year/, key: "native.hr.refusal.splitYear" },
  { re: /^A leave can be at most \d+ days/, key: "native.hr.refusal.tooLong" },
  { re: / joined on \d{4}-\d{2}-\d{2}$/, key: "native.hr.refusal.beforeJoin" },
  { re: / has left$/, key: "native.hr.refusal.left" },
  { re: /^You are not linked to a person/, key: "native.hr.refusal.notLinked" },
  { re: /^Only ([\d.]+) days of (.+) are left$/, key: "native.hr.refusal.quota", vars: (m) => ({ days: m[1]!, kind: m[2]! }) },
  { re: /^The payroll for \d{4}-\d{2} is locked/, key: "native.hr.refusal.locked" },
];

export function leaveError(t: Translate, error: unknown): string {
  if (writeFailureKind(error) === "unsure") return t("native.hr.leave.unsure");
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  if (typeof message === "string") {
    for (const e of LEAVE_REFUSALS) {
      const m = e.re.exec(message);
      if (m) return t(e.key, e.vars?.(m));
    }
  }
  return serverRefusal(error, t);
}
