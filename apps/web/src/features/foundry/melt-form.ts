/**
 * The melt stepper's form (W2-FD-W, FP-FD-03..08). The person types text; this module turns it into
 * the grams, milli-units, tenths of an inch and instants `foundry.melts.save` takes, and reads a
 * saved draft back into text. The server owns every figure that is stored (burn, yield, verdict,
 * gates): the numbers computed here are previews for the person typing, never sent.
 */
import { FOUNDRY_LINE_MAX_G, furnaceLoad, meltBalance, parseDecimal, type MeltLockBalance } from "@orrn/domain";

import { MELT_TIME_KEYS, resolveMeltTimes, splitInstant, type MeltTimeKey, type MeltTimes } from "./melt-times";

export const LDO_KEYS = ["start", "chargingStart", "chargingEnd", "castingStart", "end"] as const;
export type LdoKey = (typeof LDO_KEYS)[number];

export const MM_PER_FT = 304.8;
export const MAX_LOT_LINES = 60;
export const MAX_STREAM_RETURNS = 10;
export const MAX_LOG_LINES = 10;
export const MAX_CHEMICALS = 40;

export type LotLine = { key: string; lotId: string; kgText: string };
export type StreamLine = { key: string; streamId: string; kgText: string };
export type ChemLine = { key: string; storeItemId: string; name: string; unit: string; openText: string; usedText: string; closeText: string };
export type LogLine = { key: string; pcsText: string; lengthText: string; billetLengthText: string; kgText: string };

export type MeltForm = {
  date: string;
  times: MeltTimes;
  furnaceId: string;
  /** "" = the cast's alloy. */
  alloyId: string;
  alloyReason: string;
  ldo: Record<LdoKey, string>;
  lots: LotLine[];
  streams: StreamLine[];
  chemicals: ChemLine[];
  logs: LogLine[];
  drossKg: string;
  feKg: string;
  returns: StreamLine[];
  balanceNote: string;
  spectroReason: string;
  notes: string;
};

export const STEPS = ["times", "charge", "chemicals", "output", "spectro"] as const;
export type Step = (typeof STEPS)[number];

export function blankForm(date: string, furnaceId = ""): MeltForm {
  return {
    date,
    times: { preheatStart: "", chargingStart: "", chargingEnd: "", castingStart: "", castingEnd: "" },
    furnaceId,
    alloyId: "",
    alloyReason: "",
    ldo: { start: "", chargingStart: "", chargingEnd: "", castingStart: "", end: "" },
    lots: [],
    streams: [],
    chemicals: [],
    logs: [],
    drossKg: "",
    feKg: "",
    returns: [],
    balanceNote: "",
    spectroReason: "",
    notes: "",
  };
}

let counter = 0;
/** A stable React key for a new line. */
export const lineKey = (): string => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

// --- Text <-> units --------------------------------------------------------------------------------

/** Typed kg to whole grams: null for blank or not a number, never negative. */
export function kgToG(text: string): number | null {
  const n = parseDecimal(text);
  return n === null || n < 0 ? null : Math.round(n * 1000);
}
export function gToKgText(g: number | null | undefined): string {
  return g === null || g === undefined ? "" : String(Math.round(g) / 1000);
}
/** Typed feet (12, 19.5) to whole mm. */
export function ftToMm(text: string): number | null {
  const n = parseDecimal(text);
  return n === null || n <= 0 ? null : Math.round(n * MM_PER_FT);
}
export function mmToFtText(mm: number | null | undefined): string {
  if (mm === null || mm === undefined) return "";
  return String(Math.round((mm / MM_PER_FT) * 100) / 100);
}
/** Typed LDO inches ("42.5") to tenths of an inch. */
export function inchToTenth(text: string): number | null {
  const n = parseDecimal(text);
  return n === null || n < 0 ? null : Math.round(n * 10);
}
export function tenthToInchText(tenth: number | null | undefined): string {
  return tenth === null || tenth === undefined ? "" : String(tenth / 10);
}
/** Typed store quantity to thousandths of a unit. */
export function qtyToMilli(text: string): number | null {
  const n = parseDecimal(text);
  return n === null || n < 0 ? null : Math.round(n * 1000);
}
export function milliToQtyText(milli: number | null | undefined): string {
  return milli === null || milli === undefined ? "" : String(milli / 1000);
}
const wholePositive = (text: string): number | null => {
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
};

const blank = (s: string) => s.trim() === "";

// --- Live preview ----------------------------------------------------------------------------------

export type Figures = {
  lotsG: number;
  streamsG: number;
  logsG: number;
  drossG: number;
  feG: number;
  returnsG: number;
  balance: MeltLockBalance;
  /** Per-field: a typed kg that is not a number. */
  badKg: boolean;
  load: "ok" | "near" | "over" | null;
};

/** What the person typed, summed the way the server will (grams); blank counts 0. */
export function figuresOf(form: MeltForm, capacityG: number | null): Figures {
  let bad = false;
  const sum = (lines: readonly { kgText: string }[]) =>
    lines.reduce((s, l) => {
      if (blank(l.kgText)) return s;
      const g = kgToG(l.kgText);
      if (g === null) {
        bad = true;
        return s;
      }
      return s + g;
    }, 0);
  const one = (text: string) => {
    if (blank(text)) return 0;
    const g = kgToG(text);
    if (g === null) {
      bad = true;
      return 0;
    }
    return g;
  };
  const lotsG = sum(form.lots);
  const streamsG = sum(form.streams);
  const logsG = sum(form.logs);
  const drossG = one(form.drossKg);
  const feG = one(form.feKg);
  const returnsG = sum(form.returns);
  const balance = meltBalance({ lotsG, streamsG, logsG, drossG, feG, returnsG });
  return { lotsG, streamsG, logsG, drossG, feG, returnsG, balance, badKg: bad, load: capacityG ? furnaceLoad(balance.metalInG, capacityG) : null };
}

// --- Form -> save input ----------------------------------------------------------------------------

export type FormIssueCode =
  | "date"
  | "time"
  | "kg"
  | "kgTooLarge"
  | "lot"
  | "stream"
  | "duplicateLot"
  | "duplicateStream"
  | "chemical"
  | "chemicalClose"
  | "log"
  | "ldo"
  | "tooMany";
export type FormIssue = { code: FormIssueCode; step: Step; /** Zero-based line, when the problem is on one. */ line?: number };

export type SaveContext = {
  castId: string;
  meltId?: string;
  expectedServerSeq?: number;
  timeZone: string;
  clientRequestId?: string;
};

export type SaveInput = {
  meltId?: string;
  castId: string;
  expectedServerSeq?: number;
  furnaceId: string | null;
  alloyId: string | null;
  alloyReason?: string;
  times: Partial<Record<MeltTimeKey, number | null>>;
  ldoTenthIn: Partial<Record<LdoKey, number | null>>;
  inputs: { kind: "lot" | "return_stream"; ref: string; kgG: number }[];
  chemicals: { storeItemId?: string; name?: string; unit?: "kg" | "g" | "l" | "ml" | "pcs"; openMilli: number; usedMilli: number; closeMilli: number }[];
  logs: { pcs: number; lengthMm: number; billetLengthMm?: number; kgG: number }[];
  drossG: number;
  feG: number;
  returns: { streamId: string; kgG: number }[];
  balanceNote?: string;
  spectroReason?: string;
  notes?: string;
  clientRequestId?: string;
};

type StoreUnit = SaveInput["chemicals"][number]["unit"];
const UNITS = ["kg", "g", "l", "ml", "pcs"] as const;

/**
 * The form as a `melts.save` body, or the first thing that cannot be sent. A draft may leave a lot of
 * the sheet blank (that is what a draft is for): only text that is written but wrong is an issue.
 */
export function saveInputOf(form: MeltForm, ctx: SaveContext): { ok: true; input: SaveInput } | { ok: false; issue: FormIssue } {
  const fail = (issue: FormIssue) => ({ ok: false as const, issue });

  const times = resolveMeltTimes(form.date, form.times, ctx.timeZone);
  if (times.invalid.length > 0) return fail({ code: "time", step: "times" });
  const anyTime = MELT_TIME_KEYS.some((k) => !blank(form.times[k]));
  if (anyTime && times.epochs[MELT_TIME_KEYS.find((k) => !blank(form.times[k]))!] === null) return fail({ code: "date", step: "times" });

  const ldoTenthIn: SaveInput["ldoTenthIn"] = {};
  for (const k of LDO_KEYS) {
    if (blank(form.ldo[k])) {
      ldoTenthIn[k] = null;
      continue;
    }
    const tenth = inchToTenth(form.ldo[k]);
    if (tenth === null || tenth > 2_400) return fail({ code: "ldo", step: "chemicals" });
    ldoTenthIn[k] = tenth;
  }

  if (form.lots.length + form.streams.length > MAX_LOT_LINES) return fail({ code: "tooMany", step: "charge" });
  const inputs: SaveInput["inputs"] = [];
  const seenLots = new Set<string>();
  for (const [i, l] of form.lots.entries()) {
    if (blank(l.lotId) && blank(l.kgText)) continue;
    if (blank(l.lotId)) return fail({ code: "lot", step: "charge", line: i });
    const g = kgToG(l.kgText);
    if (g === null || g <= 0) return fail({ code: "kg", step: "charge", line: i });
    if (g > FOUNDRY_LINE_MAX_G) return fail({ code: "kgTooLarge", step: "charge", line: i });
    if (seenLots.has(l.lotId)) return fail({ code: "duplicateLot", step: "charge", line: i });
    seenLots.add(l.lotId);
    inputs.push({ kind: "lot", ref: l.lotId, kgG: g });
  }
  const seenStreams = new Set<string>();
  for (const [i, s] of form.streams.entries()) {
    if (blank(s.streamId) && blank(s.kgText)) continue;
    if (blank(s.streamId)) return fail({ code: "stream", step: "charge", line: i });
    const g = kgToG(s.kgText);
    if (g === null || g <= 0) return fail({ code: "kg", step: "charge", line: i });
    if (g > FOUNDRY_LINE_MAX_G) return fail({ code: "kgTooLarge", step: "charge", line: i });
    if (seenStreams.has(s.streamId)) return fail({ code: "duplicateStream", step: "charge", line: i });
    seenStreams.add(s.streamId);
    inputs.push({ kind: "return_stream", ref: s.streamId, kgG: g });
  }

  const chemicals: SaveInput["chemicals"] = [];
  for (const [i, c] of form.chemicals.entries()) {
    if (blank(c.storeItemId) && blank(c.name) && blank(c.openText) && blank(c.usedText) && blank(c.closeText)) continue;
    const open = qtyToMilli(c.openText);
    const used = qtyToMilli(c.usedText);
    const close = blank(c.closeText) ? null : qtyToMilli(c.closeText);
    if (open === null || used === null) return fail({ code: "chemical", step: "chemicals", line: i });
    // The server wants close = open - used. When close is blank, compute it; when typed, it must agree.
    const closeMilli = close ?? open - used;
    if (closeMilli < 0 || closeMilli !== open - used) return fail({ code: "chemicalClose", step: "chemicals", line: i });
    if (blank(c.storeItemId)) {
      if (blank(c.name) || !(UNITS as readonly string[]).includes(c.unit)) return fail({ code: "chemical", step: "chemicals", line: i });
      chemicals.push({ name: c.name.trim(), unit: c.unit as StoreUnit, openMilli: open, usedMilli: used, closeMilli });
    } else {
      chemicals.push({ storeItemId: c.storeItemId, openMilli: open, usedMilli: used, closeMilli });
    }
  }

  const logs: SaveInput["logs"] = [];
  for (const [i, l] of form.logs.entries()) {
    if (blank(l.pcsText) && blank(l.lengthText) && blank(l.kgText) && blank(l.billetLengthText)) continue;
    const pcs = wholePositive(l.pcsText);
    const lengthMm = ftToMm(l.lengthText);
    const kgG = kgToG(l.kgText);
    if (pcs === null || lengthMm === null || kgG === null || kgG <= 0) return fail({ code: "log", step: "output", line: i });
    if (kgG > FOUNDRY_LINE_MAX_G) return fail({ code: "kgTooLarge", step: "output", line: i });
    const billetLengthMm = blank(l.billetLengthText) ? null : ftToMm(l.billetLengthText);
    if (!blank(l.billetLengthText) && billetLengthMm === null) return fail({ code: "log", step: "output", line: i });
    logs.push({ pcs, lengthMm, ...(billetLengthMm !== null ? { billetLengthMm } : {}), kgG });
  }

  const drossG = blank(form.drossKg) ? 0 : kgToG(form.drossKg);
  if (drossG === null) return fail({ code: "kg", step: "output" });
  const feG = blank(form.feKg) ? 0 : kgToG(form.feKg);
  if (feG === null) return fail({ code: "kg", step: "output" });
  if (drossG > FOUNDRY_LINE_MAX_G || feG > FOUNDRY_LINE_MAX_G) return fail({ code: "kgTooLarge", step: "output" });
  const returns: SaveInput["returns"] = [];
  for (const [i, r] of form.returns.entries()) {
    if (blank(r.streamId) && blank(r.kgText)) continue;
    const g = kgToG(r.kgText);
    if (blank(r.streamId) || g === null || g <= 0) return fail({ code: "kg", step: "output", line: i });
    returns.push({ streamId: r.streamId, kgG: g });
  }

  const times5: SaveInput["times"] = {};
  for (const k of MELT_TIME_KEYS) times5[k] = times.epochs[k];

  const text = (s: string) => (blank(s) ? undefined : s.trim());
  return {
    ok: true,
    input: {
      ...(ctx.meltId ? { meltId: ctx.meltId } : {}),
      castId: ctx.castId,
      ...(ctx.expectedServerSeq !== undefined ? { expectedServerSeq: ctx.expectedServerSeq } : {}),
      furnaceId: blank(form.furnaceId) ? null : form.furnaceId,
      alloyId: blank(form.alloyId) ? null : form.alloyId,
      alloyReason: text(form.alloyReason),
      times: times5,
      ldoTenthIn,
      inputs,
      chemicals,
      logs,
      drossG,
      feG,
      returns,
      balanceNote: text(form.balanceNote),
      spectroReason: text(form.spectroReason),
      notes: text(form.notes),
      ...(ctx.clientRequestId ? { clientRequestId: ctx.clientRequestId } : {}),
    },
  };
}

// --- Saved melt -> form ----------------------------------------------------------------------------

type At = Date | string | number | null | undefined;
const ms = (at: At): number | null => {
  if (at === null || at === undefined) return null;
  const n = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return Number.isNaN(n) ? null : n;
};

/** A melt row of `casts.get` (the parts the form needs). */
export type SavedMelt = {
  furnaceId: string | null;
  alloyId: string | null;
  alloyReason: string | null;
  preheatStartAt: At;
  chargingStartAt: At;
  chargingEndAt: At;
  castingStartAt: At;
  castingEndAt: At;
  ldoStartTenthIn: number | null;
  ldoChargingStartTenthIn: number | null;
  ldoChargingEndTenthIn: number | null;
  ldoCastingStartTenthIn: number | null;
  ldoEndTenthIn: number | null;
  drossG: number;
  feG: number;
  balanceNote: string | null;
  spectroReason: string | null;
  notes: string | null;
  inputs: { kind: string; lotId: string | null; returnStreamId: string | null; kgG: number }[];
  outputs: { kind: string; returnStreamId: string | null; pcs: number | null; lengthMm: number | null; billetLengthMm: number | null; kgG: number }[];
  chemicals: { storeItemId: string | null; name: string | null; unit: string | null; openMilli: number; usedMilli: number; closeMilli: number }[];
};

/** The saved draft as text, on the plant's clock. `fallbackDate` is used while no time is written yet. */
export function formFromMelt(m: SavedMelt, timeZone: string, fallbackDate: string): MeltForm {
  const at: Record<MeltTimeKey, number | null> = {
    preheatStart: ms(m.preheatStartAt),
    chargingStart: ms(m.chargingStartAt),
    chargingEnd: ms(m.chargingEndAt),
    castingStart: ms(m.castingStartAt),
    castingEnd: ms(m.castingEndAt),
  };
  const first = MELT_TIME_KEYS.map((k) => at[k]).find((v): v is number => v !== null);
  const date = first !== undefined ? splitInstant(first, timeZone).date : fallbackDate;
  const times = {} as MeltTimes;
  for (const k of MELT_TIME_KEYS) times[k] = at[k] === null ? "" : splitInstant(at[k]!, timeZone).time;
  return {
    date,
    times,
    furnaceId: m.furnaceId ?? "",
    alloyId: m.alloyId ?? "",
    alloyReason: m.alloyReason ?? "",
    ldo: {
      start: tenthToInchText(m.ldoStartTenthIn),
      chargingStart: tenthToInchText(m.ldoChargingStartTenthIn),
      chargingEnd: tenthToInchText(m.ldoChargingEndTenthIn),
      castingStart: tenthToInchText(m.ldoCastingStartTenthIn),
      end: tenthToInchText(m.ldoEndTenthIn),
    },
    lots: m.inputs.filter((i) => i.kind === "lot" && i.lotId).map((i) => ({ key: lineKey(), lotId: i.lotId!, kgText: gToKgText(i.kgG) })),
    streams: m.inputs.filter((i) => i.kind === "return_stream" && i.returnStreamId).map((i) => ({ key: lineKey(), streamId: i.returnStreamId!, kgText: gToKgText(i.kgG) })),
    chemicals: m.chemicals.map((c) => ({
      key: lineKey(),
      storeItemId: c.storeItemId ?? "",
      name: c.name ?? "",
      unit: c.unit ?? "",
      openText: milliToQtyText(c.openMilli),
      usedText: milliToQtyText(c.usedMilli),
      closeText: milliToQtyText(c.closeMilli),
    })),
    logs: m.outputs
      .filter((o) => o.kind === "logs")
      .map((o) => ({
        key: lineKey(),
        pcsText: o.pcs ? String(o.pcs) : "",
        lengthText: mmToFtText(o.lengthMm),
        billetLengthText: o.billetLengthMm && o.billetLengthMm !== o.lengthMm ? mmToFtText(o.billetLengthMm) : "",
        kgText: gToKgText(o.kgG),
      })),
    drossKg: m.drossG ? gToKgText(m.drossG) : "",
    feKg: m.feG ? gToKgText(m.feG) : "",
    returns: m.outputs.filter((o) => o.kind === "return_stream" && o.returnStreamId).map((o) => ({ key: lineKey(), streamId: o.returnStreamId!, kgText: gToKgText(o.kgG) })),
    balanceNote: m.balanceNote ?? "",
    spectroReason: m.spectroReason ?? "",
    notes: m.notes ?? "",
  };
}

/** Whether two forms say the same thing (keys ignored): is there anything unsaved? */
export function sameForm(a: MeltForm, b: MeltForm): boolean {
  const strip = (f: MeltForm) =>
    JSON.stringify(f, (k, v) => (k === "key" ? undefined : v));
  return strip(a) === strip(b);
}
