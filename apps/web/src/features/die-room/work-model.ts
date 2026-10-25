import type { MessageKey, Translate } from "@orrn/i18n";

/**
 * FP-DR-18 die work log on the copy card: the pure parts (kind label, day input, form checks), so
 * they are unit-tested. The server decides what is allowed; these only keep the form honest.
 */

/** A work kind in the reader's language: `reasons.die_work.<code>` for a seeded code, the stored label otherwise. */
export function workKindLabel(t: Translate, code: string, label: string | null | undefined): string {
  const key = `reasons.die_work.${code}` as MessageKey;
  const text = t(key);
  return text === key ? (label ?? code) : text;
}

/** Today in the plant's zone as `YYYY-MM-DD` (the `<input type="date">` value). */
export function todayYmd(now: Date = new Date(), timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** `YYYY-MM-DD` as noon IST of that day (06:30 UTC), so the day never shifts when shown; null when not a date. */
export function ymdToWorkedAt(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 6, 30);
  const back = new Date(at);
  if (back.getUTCFullYear() !== Number(m[1]) || back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null;
  return at;
}

export type WorkDraft = { kindId: string; code: string; requiresNote: boolean; day: string; hv: string; note: string; backOnTrial: boolean };

export type WorkDraftError = "kind" | "note" | "hv" | "day";

/** The input for `dieInstance.work.add`, or the first thing to fix. */
export function workInput(
  draft: WorkDraft,
  dieInstanceId: string,
  today: string,
): { ok: true; input: { dieInstanceId: string; reasonCodeId: string; workedAt: number; note?: string; hardness?: number; setOnTrial?: boolean } } | { ok: false; error: WorkDraftError } {
  if (!draft.kindId) return { ok: false, error: "kind" };
  const note = draft.note.trim();
  if ((draft.requiresNote || draft.code === "other") && note === "") return { ok: false, error: "note" };
  const workedAt = ymdToWorkedAt(draft.day);
  if (workedAt === null || draft.day > today) return { ok: false, error: "day" };
  let hardness: number | undefined;
  if (draft.hv.trim() !== "") {
    const n = Number(draft.hv.trim());
    if (!Number.isInteger(n) || n < 1 || n > 5_000) return { ok: false, error: "hv" };
    hardness = n;
  }
  return {
    ok: true,
    input: {
      dieInstanceId,
      reasonCodeId: draft.kindId,
      workedAt,
      ...(note ? { note } : {}),
      ...(hardness ? { hardness } : {}),
      ...(draft.code === "correct" && draft.backOnTrial ? { setOnTrial: true } : {}),
    },
  };
}

/** Work is logged on the rack only (the server refuses the rest). */
export function canLogWork(status: string): boolean {
  return status === "available" || status === "on_trial";
}
