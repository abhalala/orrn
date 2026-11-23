/**
 * XE parity lane REG: pure rules behind the registers and views (rows #18, #31, #32, #34, #49, #53,
 * #74, #81, #82). Routers stay thin: the server reads rows and calls these; every derived number a
 * screen shows comes from here or from SQL, never from the client.
 */
import { recoveryBp } from "./pressRun";

// ── Complaints (#18, #34) ───────────────────────────────────────────────────

export const COMPLAINT_STATUS_LIST = ["open", "investigating", "replied", "closed"] as const;
export type ComplaintStatusValue = (typeof COMPLAINT_STATUS_LIST)[number];

/**
 * The status flow. A complaint is investigated, then answered, then closed. The office may answer or
 * close straight away (a short supply needs no root cause), and an answer the customer does not
 * accept goes back to investigating. A closed complaint stays closed: a new problem is a new number.
 */
export const COMPLAINT_MOVES: Readonly<Record<ComplaintStatusValue, readonly ComplaintStatusValue[]>> = {
  open: ["investigating", "replied", "closed"],
  investigating: ["replied", "closed"],
  replied: ["investigating", "closed"],
  closed: [],
};

export function complaintNext(from: ComplaintStatusValue, to: ComplaintStatusValue): boolean {
  return COMPLAINT_MOVES[from].includes(to);
}

/** A complaint can still be worked on (investigation fields, reply). */
export function complaintEditable(status: ComplaintStatusValue): boolean {
  return status !== "closed";
}

// ── Recut (#31) ─────────────────────────────────────────────────────────────

/**
 * Kg lost to a recut: the bundle was cut shorter than its trolley line with the same pieces, so the
 * cut-off part is `weight × (from − to) ÷ to` (the bundle's own kg per mm). 0 when not shorter or
 * when a length is missing. Grams, rounded half up.
 */
export function recutLossG(r: { weightG: number; lengthMm: number; fromLengthMm: number | null }): number {
  if (r.fromLengthMm == null || !(r.lengthMm > 0) || !(r.fromLengthMm > r.lengthMm) || !(r.weightG > 0)) return 0;
  return Math.round((r.weightG * (r.fromLengthMm - r.lengthMm)) / r.lengthMm);
}

// ── Work in progress per order line (#32) ───────────────────────────────────

export const WIP_STAGES = ["notPlanned", "planned", "onPress", "ageing", "unpacked", "packed", "dispatched"] as const;
export type WipStage = (typeof WIP_STAGES)[number];
export type WipStages = Record<WipStage, number> & { orderedG: number; overG: number };

/**
 * Where every kg of an order line sits, from the balance strip's own figures (`lib/orderStrip.ts`):
 *
 * - planned: plan kg still ahead of the press, less the part whose run is on the press now
 * - onPress: plan kg of a run that is running, stopped or being counted (not logged yet)
 * - ageing: kg on a trolley that is not released yet (loading, in the oven, out untested, held)
 * - unpacked: pressed and not packed: released trolley kg plus pressed kg that never went to a trolley
 * - packed: packed bundles still in the plant (in stock or on a truck being loaded)
 * - dispatched: bundles of completed dispatches
 * - notPlanned: what is left of the ordered kg (never below 0); overG is produced beyond ordered
 *
 * The stages add up to max(ordered, sum of the others): the screen draws them as one bar.
 */
export function wipStages(r: {
  orderedG: number;
  plannedG: number;
  onPressG: number;
  /** Strip `pressedG`: pressed, not on a trolley, not packed. */
  pressedG: number;
  /** Strip `agedG`: still on a trolley (any state). */
  agedG: number;
  /** The part of `agedG` on released trolley lines. */
  releasedG: number;
  /** Strip `packedG`: available + reserved bundles of the line. */
  packedG: number;
  dispatchedG: number;
  producedG: number;
}): WipStages {
  const pos = (n: number) => Math.max(0, Math.round(n));
  const onPress = pos(Math.min(r.onPressG, r.plannedG));
  const planned = pos(r.plannedG - onPress);
  const released = pos(Math.min(r.releasedG, r.agedG));
  const ageing = pos(r.agedG - released);
  const unpacked = pos(r.pressedG) + released;
  const packed = pos(r.packedG);
  const dispatched = pos(r.dispatchedG);
  const notPlanned = pos(r.orderedG - planned - onPress - ageing - unpacked - packed - dispatched);
  return { orderedG: pos(r.orderedG), notPlanned, planned, onPress, ageing, unpacked, packed, dispatched, overG: pos(r.producedG - r.orderedG) };
}

/** The furthest stage that holds any kg: the one-word status line the portal shows. */
export function wipHeadline(s: WipStages): WipStage {
  if (s.notPlanned === 0 && s.dispatched > 0 && s.planned + s.onPress + s.ageing + s.unpacked + s.packed === 0) return "dispatched";
  // The stage nearest the customer that still has kg waiting, else not planned yet.
  for (const k of ["packed", "unpacked", "ageing", "onPress", "planned"] as const) if (s[k] > 0) return k;
  return "notPlanned";
}

// ── Plan against actual (#53) ───────────────────────────────────────────────

/** Gap = actual − planned (negative: short of plan); share of plan in basis points, null without a plan. */
export function planGap(plannedG: number, actualG: number): { gapG: number; achievedBp: number | null } {
  return { gapG: actualG - plannedG, achievedBp: plannedG > 0 ? Math.round((actualG * 10_000) / plannedG) : null };
}

// ── Material reconciliation (#74) ───────────────────────────────────────────

export const MATERIAL_CLASSES = ["metal", "billet", "bundle"] as const;
export type MaterialClass = (typeof MATERIAL_CLASSES)[number];

/** How a ledger posting counts: a document that moves material (`flow`), a correction (`adjust`), or neither. */
export type LedgerPostingRole = "flow" | "adjust" | "move" | "skip";

export type ReconGroup = { group: string; role: "flow" | "adjust"; netG: number };

/**
 * Opening + in − out + gap = closing for one material class over a period. The stock ledger is one
 * append-only table, so it always balances; what the plant needs to see is how much of the movement
 * no flow document explains. `in` and `out` are the period's net postings of flow documents (purchase,
 * melt, press close, pack, pack reject, dispatch; a reversal is netted into the document it reverses),
 * one figure per document kind, positive in and negative out. The gap is the net of correction postings:
 * opening balances taken on, billet count tails at cast close, bundle voids and their restores (a
 * phantom void at a stock count is a void). Moves between locations net to zero and are left out.
 * `balanced` is the check that the closing balance read from the ledger equals the sum.
 */
export function reconcileMaterial(r: { openingG: number; closingG: number; groups: readonly ReconGroup[] }) {
  const inBy: { group: string; g: number }[] = [];
  const outBy: { group: string; g: number }[] = [];
  const gapBy: { group: string; g: number }[] = [];
  for (const g of r.groups) {
    if (g.netG === 0) continue;
    if (g.role === "adjust") gapBy.push({ group: g.group, g: g.netG });
    else if (g.netG > 0) inBy.push({ group: g.group, g: g.netG });
    else outBy.push({ group: g.group, g: -g.netG });
  }
  const inG = inBy.reduce((s, x) => s + x.g, 0);
  const outG = outBy.reduce((s, x) => s + x.g, 0);
  const gapG = gapBy.reduce((s, x) => s + x.g, 0);
  return {
    openingG: r.openingG,
    inG,
    outG,
    gapG,
    closingG: r.closingG,
    inBy,
    outBy,
    gapBy,
    balanced: r.openingG + inG - outG + gapG === r.closingG,
  };
}

// ── Billet need per plan (#49) ──────────────────────────────────────────────

/** Recovery used when neither the die nor the plant has a logged production run yet. */
export const DEFAULT_RECOVERY_BP = 8_000;

export type DieBilletHistory = {
  /** Σ input (weighed billet kg) and Σ good of the die's logged production runs. */
  inputG: number;
  goodG: number;
  /** The billet length this die used most (mm), and the average kg of one billet of it (grams). */
  billetLengthMm: number | null;
  billetG: number | null;
};

export type BilletNeedLine = {
  key: string;
  sectionId: string;
  alloy: string | null;
  /** The plan line's stored kg (grams of good pieces wanted). */
  kgG: number;
  /** The die room has a copy of this section it can issue (not at nitriding, the maker or retired). */
  dieReady: boolean;
};

export type BilletNeedRow = {
  key: string;
  sectionId: string;
  alloy: string | null;
  kgG: number;
  recoveryBp: number;
  recoverySource: "die" | "plant" | "default";
  billetKgG: number;
  billetLengthMm: number | null;
  billets: number | null;
  /** Billets of this alloy left after this line and every line above it. */
  stockAfterG: number;
  billetsEnough: boolean;
  dieReady: boolean;
  ready: boolean;
};

/**
 * Billets a press plan needs, line by line in plan order. Each die uses its OWN recovery (Σ good ÷
 * Σ input of its logged production runs), else the plant's, else `DEFAULT_RECOVERY_BP`, and the
 * source is said on the row. Billet kg = plan kg ÷ recovery (rounded up to the gram); the count uses
 * the die's usual billet length and weight when it has a history. "Billets enough" is cumulative per
 * alloy: the stock of an alloy is spent down the plan, so a later line can run short even when it would
 * fit alone. A line with no alloy is never "enough". Totals are by alloy and billet length.
 */
export function billetNeed(input: {
  lines: readonly BilletNeedLine[];
  history: ReadonlyMap<string, DieBilletHistory>;
  plant: { inputG: number; goodG: number };
  stockByAlloy: ReadonlyMap<string, number>;
}) {
  const left = new Map(input.stockByAlloy);
  const plantBp = recoveryBp(input.plant.goodG, input.plant.inputG);
  const rows: BilletNeedRow[] = input.lines.map((l) => {
    const h = input.history.get(l.sectionId);
    const dieBp = h ? recoveryBp(h.goodG, h.inputG) : null;
    const [bp, source] =
      dieBp != null && dieBp > 0 ? [dieBp, "die" as const] : plantBp != null && plantBp > 0 ? [plantBp, "plant" as const] : [DEFAULT_RECOVERY_BP, "default" as const];
    const billetKgG = Math.ceil((l.kgG * 10_000) / bp);
    const billets = h?.billetG && h.billetG > 0 ? Math.ceil(billetKgG / h.billetG) : null;
    const stock = l.alloy == null ? 0 : (left.get(l.alloy) ?? 0);
    const after = stock - billetKgG;
    if (l.alloy != null) left.set(l.alloy, after);
    const billetsEnough = l.alloy != null && after >= 0;
    return {
      key: l.key,
      sectionId: l.sectionId,
      alloy: l.alloy,
      kgG: l.kgG,
      recoveryBp: bp,
      recoverySource: source,
      billetKgG,
      billetLengthMm: h?.billetLengthMm ?? null,
      billets,
      stockAfterG: after,
      billetsEnough,
      dieReady: l.dieReady,
      ready: billetsEnough && l.dieReady,
    };
  });
  const totals = new Map<string, { alloy: string | null; billetLengthMm: number | null; billetKgG: number; billets: number | null; stockG: number }>();
  for (const r of rows) {
    const k = `${r.alloy ?? ""}|${r.billetLengthMm ?? ""}`;
    const t = totals.get(k) ?? { alloy: r.alloy, billetLengthMm: r.billetLengthMm, billetKgG: 0, billets: 0, stockG: r.alloy == null ? 0 : (input.stockByAlloy.get(r.alloy) ?? 0) };
    t.billetKgG += r.billetKgG;
    t.billets = t.billets == null || r.billets == null ? null : t.billets + r.billets;
    totals.set(k, t);
  }
  return { rows, totals: [...totals.values()] };
}

// ── Morning summary (#81, #82) ──────────────────────────────────────────────

export const MORNING_SUMMARY_DEFAULT_HOUR = 7;

export type MorningSummarySettings = { enabled: boolean; hour: number };

/** `settings.morningSummary` as stored, with defaults: off, 07:00 plant time. */
export function readMorningSummarySettings(raw: unknown): MorningSummarySettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hour = typeof o.hour === "number" && Number.isInteger(o.hour) && o.hour >= 0 && o.hour <= 23 ? o.hour : MORNING_SUMMARY_DEFAULT_HOUR;
  return { enabled: o.enabled === true, hour };
}

/** The hourly tick sends a plant's summary in the plant's chosen hour, once a day (the server keeps the marker). */
export function morningSummaryDue(s: MorningSummarySettings, localHour: number): boolean {
  return s.enabled && localHour === s.hour;
}

export type MorningFigures = {
  day: string;
  pressedG: number;
  inputG: number;
  recoveryBp: number | null;
  runs: number;
  trialG: number;
  downtime: { reason: string; minutes: number }[];
  downtimeMinutes: number;
  dispatches: number;
  dispatchedG: number;
  openLines: number;
  bakiG: number;
  failedCasts: { number: string; alloy: string | null }[];
};

const kg = (g: number) => (g / 1000).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (bp: number | null) => (bp == null ? "no runs" : `${(bp / 100).toFixed(1)} %`);

/** The plain text of the morning mail (English: the mail path has no plant language). No rupee figure. */
export function morningSummaryLines(plant: string, f: MorningFigures): string[] {
  const lines = [
    `${plant}: ${f.day}`,
    `Pressed: ${kg(f.pressedG)} kg in ${f.runs} ${f.runs === 1 ? "run" : "runs"}, recovery ${pct(f.recoveryBp)}${f.trialG > 0 ? ` (trials ${kg(f.trialG)} kg)` : ""}`,
    `Downtime: ${f.downtimeMinutes} min${f.downtime.length ? ` (${f.downtime.map((d) => `${d.reason} ${d.minutes} min`).join(", ")})` : ""}`,
    `Dispatched: ${kg(f.dispatchedG)} kg on ${f.dispatches} ${f.dispatches === 1 ? "load" : "loads"}`,
    `Open baki: ${kg(f.bakiG)} kg on ${f.openLines} order ${f.openLines === 1 ? "line" : "lines"}`,
    f.failedCasts.length
      ? `Casts with failed spectro: ${f.failedCasts.map((c) => (c.alloy ? `${c.number} (${c.alloy})` : c.number)).join(", ")}`
      : "Casts with failed spectro: none",
  ];
  return lines;
}
