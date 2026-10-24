import {
  MM_PER_INCH,
  formatKg,
  formatKgTotal,
  formatLength,
  gToKg,
  kgToG,
  parseDecimal,
} from "@orrn/domain";

/**
 * Fixture metal for the press preview. Recovery is never a typed field:
 * `recoveryBp = round(goodG * 10000 / inputG)`, half away from zero.
 * Display is one decimal from those basis points (7545 → 75.5%).
 */


export const BALANCE_WARN_BP = 200;
export const PRODUCTION_DAY = "24 Oct 2026";
export const PREVIEW_START = "09:12";
export const PREVIEW_STOP = "11:04";
/** 09:12 to 11:04, the preview clock window. */
export const WINDOW_MIN = 11 * 60 + 4 - (9 * 60 + 12);

export const LINE = {
  code: "P1",
  name: "Press 1",
  tonnageT: null as number | null,
} as const;

export const SECTION = {
  code: "12170",
  series: "Domal",
  label: "12170 Domal",
  bandMinKg: 5.9,
  bandMaxKg: 6.2,
  /** Latest reading on 12170-1, grams per 12 ft. */
  latestMilli: 5967,
  latestKg: 5.967,
} as const;

export const COPIES = [
  { code: "12170-1", kgPer12ft: 5.967, status: "in_use" as const, issuedTo: "PR-42" },
  { code: "12170-2", kgPer12ft: 6.48, status: "available" as const, issuedTo: null },
] as const;

export const ISSUE = {
  copy: "12170-1",
  at: "08:40",
  by: "Die room",
} as const;

export const PEOPLE = {
  operator: "Raju",
  supervisor: "Mahesh",
  relief: "Suresh",
  owner: "Owner",
} as const;

export const SHIFTS = [
  { id: "day" as const, name: "Day", start: "08:00", end: "20:00" },
  { id: "night" as const, name: "Night", start: "20:00", end: "08:00" },
];

export type ShiftId = (typeof SHIFTS)[number]["id"];
export type Viewer = "supervisor" | "operator";
export type ClockPhase = "counting" | "running" | "stopped" | "logged";

export const DOWNTIME_REASONS = [
  { code: "die_change", label: "Die change" },
  { code: "billet_wait", label: "Billet wait" },
  { code: "breakdown", label: "Breakdown" },
  { code: "power", label: "Power" },
  { code: "no_order", label: "No order" },
  { code: "die_correction", label: "Die correction" },
  { code: "quality_hold", label: "Quality hold" },
  { code: "other", label: "Other" },
] as const;

export const QC_REASONS = [
  { code: "dimension", label: "Dimension" },
  { code: "surface", label: "Surface" },
  { code: "bend", label: "Bend" },
  { code: "crack", label: "Crack" },
  { code: "short_length", label: "Short length" },
  { code: "other", label: "Other" },
] as const;

export type ReasonCode = (typeof DOWNTIME_REASONS)[number]["code"];

export const ORDERS = [
  {
    number: "SO-18",
    customer: "Bhavesh Traders",
    city: "Ahmedabad",
    short: "Bhavesh",
    orderedKg: 1193.4,
    orderedPcs: 200,
    dispatchedKg: 0,
    dispatchedPcs: 0,
  },
  {
    number: "SO-19",
    customer: "Anshu Aluminium",
    city: "Rajkot",
    short: "Anshu",
    orderedKg: 556.92,
    orderedPcs: 80,
    dispatchedKg: 0,
    dispatchedPcs: 0,
  },
] as const;

export type OrderNumber = (typeof ORDERS)[number]["number"];

export const CASTS = [
  { code: "K31", onHandKg: 5860, closed: false, spectroFail: false },
  { code: "H24", onHandKg: 860, closed: true, spectroFail: true },
  { code: "K27", onHandKg: 40.2, closed: false, spectroFail: false },
] as const;

export const PR43 = {
  number: "PR-43",
  status: "queued" as const,
  cuts: [
    { salesOrder: "SO-18" as const, cutLengthMm: feetToMm(12), pcs: 24 },
    { salesOrder: "SO-19" as const, cutLengthMm: feetToMm(14), pcs: 16 },
  ],
};

export const COUNT_STEPS = ["Billets", "Pieces", "Butt and ends", "Rejects", "Remarks"] as const;

export function feetToMm(feet: number): number {
  return Math.round(feet * 12 * MM_PER_INCH);
}

export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

/** Server formula. Null when input is not positive — never 0%. */
export function recoveryBp(goodG: number, inputG: number): number | null {
  if (!(inputG > 0) || !Number.isFinite(goodG)) return null;
  return roundHalfAwayFromZero((goodG * 10000) / inputG);
}

/** One decimal from basis points. Does not divide the raw kg again. */
export function formatRecoveryBp(bp: number): string {
  return `${(bp / 100).toFixed(1)}%`;
}

export function formatKgG(g: number): string {
  return formatKgTotal(gToKg(g));
}

export function formatBand(): string {
  return `${formatKg(SECTION.bandMinKg, 3)}–${formatKg(SECTION.bandMaxKg, 3)} kg per 12 ft`;
}

export function lengthLabel(mm: number): string {
  return formatLength(mm, "inch");
}

export function reasonLabel(code: string): string {
  const row = [...DOWNTIME_REASONS, ...QC_REASONS].find((item) => item.code === code);
  return row ? row.label : code;
}

export function orderByNumber(number: string) {
  return ORDERS.find((order) => order.number === number);
}

/** Baki is ordered − dispatched. Pressed never moves it. */
export function bakiKg(order: (typeof ORDERS)[number]): number {
  return order.orderedKg - order.dispatchedKg;
}

export function castByCode(code: string) {
  return CASTS.find((cast) => cast.code === code) ?? CASTS[0];
}

/** Lightest in-band copy. A hint for the die room, not a start. */
export function lightestInBandCopy() {
  const inBand = COPIES.filter(
    (copy) => copy.kgPer12ft >= SECTION.bandMinKg && copy.kgPer12ft <= SECTION.bandMaxKg,
  );
  return [...inBand].sort((a, b) => a.kgPer12ft - b.kgPer12ft)[0] ?? null;
}

/**
 * Hint beside a weighed field. Grams, from the latest reading.
 * `pcs × lengthMm / (144 × MM_PER_INCH) × kg_per_12ft_milli`.
 * Not copied into the weight.
 */
export function theoreticalGoodG(pcs: number, lengthMm: number, kgPer12ftMilli: number): number | null {
  if (!(pcs > 0) || !(lengthMm > 0) || !(kgPer12ftMilli > 0)) return null;
  return (pcs * lengthMm) / (144 * MM_PER_INCH) * kgPer12ftMilli;
}

export function parseNonNegKgG(text: string): number | null {
  if (text.trim() === "") return null;
  const n = parseDecimal(text);
  if (n === null || n < 0) return null;
  return kgToG(n);
}

export function parsePositiveInt(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || !Number.isInteger(n) || n < 1) return null;
  return n;
}

export function parseNonNegInt(text: string): number | null {
  if (text.trim() === "") return null;
  const n = parseDecimal(text);
  if (n === null || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export function parseOptionalKg(text: string): number | null {
  if (text.trim() === "") return null;
  const n = parseDecimal(text);
  if (n === null || n <= 0) return null;
  return n;
}

export type BilletDraft = {
  id: string;
  lengthMm: number;
  countText: string;
  kgText: string;
};

export type CutDraft = {
  id: string;
  salesOrder: OrderNumber;
  cutLengthMm: number;
  releasedPcs: number;
  pcsText: string;
  kgText: string;
};

export type DowntimeDraft = {
  id: string;
  reason: string;
  note: string;
  minutes: number;
  open: boolean;
};

export type LoggedLine = {
  salesOrder: string;
  cutLengthMm: number;
  pcs: number;
  kgG: number;
};

export type LoggedSnapshot = {
  inputG: number;
  inputWeighedG: number;
  goodG: number;
  goodPcs: number;
  discardG: number;
  endsG: number;
  rejectG: number;
  rejectReason: string | null;
  balanceG: number;
  recoveryBp: number;
  balanceBp: number;
  balanceWarn: boolean;
  billetShortReason: string | null;
  castCode: string;
  lines: LoggedLine[];
  billetRows: { count: number; lengthMm: number; kgG: number }[];
  downtimeMin: number;
  downtimeRows: { reason: string; minutes: number }[];
  downtimeCodes: string[];
  runningMin: number;
  relief: string | null;
  pressRemark: string | null;
  dieRemark: string | null;
  driftKg: number | null;
};

export type RecoveryPreview = {
  inputG: number;
  inputWeighedG: number;
  goodG: number;
  discardG: number;
  endsG: number;
  rejectG: number;
  balanceG: number;
  recoveryBp: number;
  balanceBp: number;
  balanceWarn: boolean;
  shortBook: boolean;
  onHandG: number;
};

export type Pr42State = {
  phase: ClockPhase;
  runningSinceWall: number | null;
  step: number;
  castCode: string;
  billets: BilletDraft[];
  cuts: CutDraft[];
  buttText: string;
  endsText: string;
  /** Empty means QC was not entered. "0" is checked, none. */
  rejectText: string;
  rejectReason: string;
  rejectNote: string;
  pressRemark: string;
  dieRemark: string;
  driftText: string;
  pressedLengthText: string;
  downtime: DowntimeDraft[];
  relief: string | null;
  billetShortReason: string;
  postedInputText: string;
  logged: LoggedSnapshot | null;
  reopen: "none" | "requested" | "approved";
  reopenNote: string;
};

export type PressDemoState = {
  nothingReleased: boolean;
  showSecondReportRow: boolean;
  viewer: Viewer;
  pr43Shift: ShiftId;
  pr42: Pr42State;
};

export function freshPr42(): Pr42State {
  return {
    phase: "counting",
    runningSinceWall: null,
    step: 0,
    castCode: "K31",
    billets: [{ id: "b1", lengthMm: feetToMm(20), countText: "18", kgText: "310.4" }],
    cuts: [
      {
        id: "c18",
        salesOrder: "SO-18",
        cutLengthMm: feetToMm(12),
        releasedPcs: 80,
        pcsText: "80",
        kgText: "153.6",
      },
      {
        id: "c19",
        salesOrder: "SO-19",
        cutLengthMm: feetToMm(14),
        releasedPcs: 40,
        pcsText: "36",
        kgText: "80.6",
      },
    ],
    buttText: "28.5",
    endsText: "12.1",
    rejectText: "4.2",
    rejectReason: "surface",
    rejectNote: "",
    pressRemark: "",
    dieRemark: "",
    driftText: "",
    pressedLengthText: "",
    downtime: [{ id: "dt1", reason: "billet_wait", note: "", minutes: 18, open: false }],
    relief: null,
    billetShortReason: "",
    postedInputText: "",
    logged: null,
    reopen: "none",
    reopenNote: "",
  };
}

export function freshPressDemo(): PressDemoState {
  return {
    nothingReleased: false,
    showSecondReportRow: false,
    viewer: "supervisor",
    pr43Shift: "day",
    pr42: freshPr42(),
  };
}

export type LogEvaluation = {
  canLog: boolean;
  messages: string[];
  preview: RecoveryPreview | null;
  snapshot: LoggedSnapshot | null;
};


export function evaluateLog(draft: Pr42State, viewer: Viewer): LogEvaluation {
  const messages: string[] = [];
  const weighedParts = draft.billets.map((row) => parseNonNegKgG(row.kgText) ?? 0);
  const weighedG = weighedParts.reduce((sum, g) => sum + g, 0);
  if (!(weighedG > 0)) {
    return {
      canLog: false,
      messages: ["No billets, no recovery."],
      preview: null,
      snapshot: null,
    };
  }

  for (const row of draft.billets) {
    const count = parsePositiveInt(row.countText);
    const kg = parseNonNegKgG(row.kgText);
    if (count === null || kg === null || kg === 0) {
      messages.push("Each billet length needs a count and a weighed kg. Zero is not a recovery.");
      break;
    }
  }

  const cast = castByCode(draft.castCode);
  const onHandG = kgToG(cast.onHandKg);
  const shortBook = weighedG > onHandG;
  let postedG = weighedG;
  if (shortBook) {
    const typed = parseNonNegKgG(draft.postedInputText);
    postedG = typed !== null && typed > 0 && typed <= onHandG ? typed : onHandG;
    if (draft.billetShortReason.trim().length < 1) {
      messages.push(
        `Billet book has ${formatKgTotal(cast.onHandKg)} kg on hand. A short book needs a written reason. It does not post a negative row.`,
      );
    }
  }
  if (!(postedG > 0)) {
    messages.push("No billets, no recovery.");
  }

  const lines: LoggedLine[] = [];
  for (const cut of draft.cuts) {
    const pcs = parseNonNegInt(cut.pcsText);
    const kg = parseNonNegKgG(cut.kgText);
    if (pcs === null || kg === null) {
      messages.push("Each cut length needs pieces and a weighed kg.");
      break;
    }
    if (pcs > 0 && kg === 0) {
      messages.push("This length is not weighed. The kg/12 ft figure is a hint, not the weight.");
      break;
    }
    lines.push({ salesOrder: cut.salesOrder, cutLengthMm: cut.cutLengthMm, pcs, kgG: kg });
  }

  const goodG = lines.reduce((sum, line) => sum + line.kgG, 0);
  const goodPcs = lines.reduce((sum, line) => sum + line.pcs, 0);
  if (lines.length === draft.cuts.length && !(goodG > 0)) {
    messages.push("No good kg. A run with nothing weighed cannot log.");
  }
  if (postedG > 0 && goodG > postedG) {
    messages.push("Good kg is above the billets. Fix the weights.");
  }

  if (draft.pressedLengthText.trim() !== "") {
    const pressedMm = parsePositiveInt(draft.pressedLengthText);
    const used = lines.reduce((sum, line) => sum + line.pcs * line.cutLengthMm, 0);
    if (pressedMm === null) {
      messages.push("Pressed length must be whole millimetres, or left blank.");
    } else if (used > pressedMm) {
      messages.push(`Pieces × length is ${used.toLocaleString("en-IN")} mm, over the pressed length.`);
    }
  }

  const discard = parseNonNegKgG(draft.buttText);
  const ends = parseNonNegKgG(draft.endsText);
  if (discard === null || ends === null) {
    messages.push("Butt and ends need a weight. Zero is allowed.");
  }

  const reject = parseNonNegKgG(draft.rejectText);
  if (reject === null) {
    messages.push("QC is missing. A run cannot log without a check.");
  } else if (reject > 0 && draft.rejectReason === "") {
    messages.push("A reject needs a reason.");
  } else if (reject > 0 && draft.rejectReason === "other" && draft.rejectNote.trim() === "") {
    messages.push("Other needs a note.");
  }

  if (draft.downtime.some((row) => row.open)) {
    messages.push("Close the stoppage before logging.");
  }

  const discardG = discard ?? 0;
  const endsG = ends ?? 0;
  const rejectG = reject ?? 0;
  const bp = recoveryBp(goodG, postedG);
  let preview: RecoveryPreview | null = null;
  if (bp !== null && discard !== null && ends !== null && reject !== null) {
    const balanceG = postedG - goodG - discardG - endsG - rejectG;
    const balanceBp = roundHalfAwayFromZero((balanceG * 10000) / postedG);
    preview = {
      inputG: postedG,
      inputWeighedG: weighedG,
      goodG,
      discardG,
      endsG,
      rejectG,
      balanceG,
      recoveryBp: bp,
      balanceBp,
      balanceWarn: Math.abs(balanceBp) > BALANCE_WARN_BP,
      shortBook,
      onHandG,
    };
  }

  if (viewer === "operator") {
    messages.push("Waiting for the supervisor to log.");
  }

  const unique = [...new Set(messages)];
  if (unique.length > 0 || preview === null || viewer !== "supervisor") {
    return { canLog: false, messages: unique, preview, snapshot: null };
  }

  const closedDowntime = draft.downtime.filter((row) => !row.open);
  const downtimeMin = closedDowntime.reduce((sum, row) => sum + row.minutes, 0);
  const runningMin = WINDOW_MIN - downtimeMin;
  const balanceG = preview.balanceG;
  const snapshot: LoggedSnapshot = {
    inputG: preview.inputG,
    inputWeighedG: preview.inputWeighedG,
    goodG: preview.goodG,
    goodPcs,
    discardG: preview.discardG,
    endsG: preview.endsG,
    rejectG: preview.rejectG,
    rejectReason: preview.rejectG > 0 ? draft.rejectReason : null,
    balanceG,
    recoveryBp: preview.recoveryBp,
    balanceBp: preview.balanceBp,
    balanceWarn: preview.balanceWarn,
    billetShortReason: shortBook ? draft.billetShortReason.trim() : null,
    castCode: draft.castCode,
    lines,
    billetRows: draft.billets.map((row) => ({
      count: parsePositiveInt(row.countText) ?? 0,
      lengthMm: row.lengthMm,
      kgG: parseNonNegKgG(row.kgText) ?? 0,
    })),
    downtimeMin,
    downtimeRows: closedDowntime.map((row) => ({ reason: row.reason, minutes: row.minutes })),
    downtimeCodes: [...new Set(closedDowntime.map((row) => row.reason))],
    runningMin,
    relief: draft.relief,
    pressRemark: draft.pressRemark.trim() === "" ? null : draft.pressRemark.trim(),
    dieRemark: draft.dieRemark.trim() === "" ? null : draft.dieRemark.trim(),
    driftKg: parseOptionalKg(draft.driftText),
  };

  return { canLog: true, messages: [], preview, snapshot };
}

export function pressedSentence(snapshot: LoggedSnapshot): string {
  const orders = snapshot.lines.filter((line) => line.kgG > 0).map((line) => line.salesOrder);
  const named =
    orders.length === 0
      ? "no sales order"
      : orders.length === 1
        ? orders[0]
        : orders.length === 2
          ? `${orders[0]} and ${orders[1]}`
          : `${orders.slice(0, -1).join(", ")} and ${orders[orders.length - 1]}`;
  return `Pressed ${formatKgG(snapshot.goodG)} kg on ${named}. Baki unchanged.`;
}

export function driftPercent(readingKg: number, lastKg: number): number | null {
  if (!(lastKg > 0) || !Number.isFinite(readingKg)) return null;
  return ((readingKg - lastKg) / lastKg) * 100;
}

export function inBand(kg: number): boolean {
  return kg >= SECTION.bandMinKg && kg <= SECTION.bandMaxKg;
}

export type ReportRow = {
  id: string;
  runNo: string;
  productionDay: string;
  shift: string;
  shiftId: ShiftId;
  line: string;
  operator: string;
  section: string;
  copy: string;
  orders: string;
  cuts: string;
  cast: string;
  billets: string;
  window: string;
  runningMin: number;
  downtimeMin: number;
  downtimeCodes: string[];
  downtime: string;
  good: string;
  scrap: string;
  recovery: string;
  inputG: number;
  goodG: number;
  recoveryBp: number;
};

function formatCuts(lines: LoggedLine[]): string {
  return lines
    .map((line) => `${lengthLabel(line.cutLengthMm)} × ${line.pcs} pcs · ${formatKgG(line.kgG)} kg`)
    .join("; ");
}

function formatOrders(lines: LoggedLine[]): string {
  const numbers = [...new Set(lines.map((line) => line.salesOrder))];
  return numbers
    .map((number) => {
      const order = orderByNumber(number);
      return order ? `${order.short} ${order.number}` : number;
    })
    .join(", ");
}

function formatBillets(rows: LoggedSnapshot["billetRows"], inputG: number): string {
  const lengths = rows
    .map((row) => `${row.count} × ${lengthLabel(row.lengthMm)}`)
    .join(", ");
  return `${lengths} · ${formatKgG(inputG)} kg`;
}

export function reportRowFromSnapshot(
  runNo: string,
  snapshot: LoggedSnapshot,
  shiftId: ShiftId,
  window: string,
): ReportRow {
  const shift = SHIFTS.find((item) => item.id === shiftId) ?? SHIFTS[0];
  const operator = snapshot.relief
    ? `${PEOPLE.operator} · relief ${snapshot.relief}`
    : PEOPLE.operator;
  const downtime =
    snapshot.downtimeMin === 0
      ? "0 min"
      : `${snapshot.downtimeMin} min · ${snapshot.downtimeCodes.join(", ")}`;
  return {
    id: runNo,
    runNo,
    productionDay: PRODUCTION_DAY,
    shift: shift.name,
    shiftId,
    line: LINE.name,
    operator,
    section: SECTION.label,
    copy: ISSUE.copy,
    orders: formatOrders(snapshot.lines),
    cuts: formatCuts(snapshot.lines),
    cast: snapshot.castCode,
    billets: formatBillets(snapshot.billetRows, snapshot.inputG),
    window,
    runningMin: snapshot.runningMin,
    downtimeMin: snapshot.downtimeMin,
    downtimeCodes: snapshot.downtimeCodes,
    downtime,
    good: `${formatKgG(snapshot.goodG)} kg · ${snapshot.goodPcs} pcs`,
    scrap: `${formatKgG(snapshot.discardG)} + ${formatKgG(snapshot.endsG)} + ${formatKgG(snapshot.rejectG)} kg`,
    recovery: formatRecoveryBp(snapshot.recoveryBp),
    inputG: snapshot.inputG,
    goodG: snapshot.goodG,
    recoveryBp: snapshot.recoveryBp,
  };
}

/** Night run, only to show the sheet is not a Pareto. Recovery is computed. */
export function secondReportRow(): ReportRow {
  const inputG = kgToG(102);
  const goodG = kgToG(76.8);
  const discardG = kgToG(8.2);
  const endsG = kgToG(4.1);
  const rejectG = kgToG(1.5);
  const bp = recoveryBp(goodG, inputG);
  if (bp === null) {
    throw new Error("Second fixture row has no recovery.");
  }
  const snapshot: LoggedSnapshot = {
    inputG,
    inputWeighedG: inputG,
    goodG,
    goodPcs: 40,
    discardG,
    endsG,
    rejectG,
    rejectReason: "dimension",
    balanceG: inputG - goodG - discardG - endsG - rejectG,
    recoveryBp: bp,
    balanceBp: roundHalfAwayFromZero(((inputG - goodG - discardG - endsG - rejectG) * 10000) / inputG),
    balanceWarn: true,
    billetShortReason: null,
    castCode: "K28",
    lines: [{ salesOrder: "SO-16", cutLengthMm: feetToMm(12), pcs: 40, kgG: goodG }],
    billetRows: [{ count: 8, lengthMm: feetToMm(22), kgG: inputG }],
    downtimeMin: 12,
    downtimeRows: [{ reason: "die_change", minutes: 12 }],
    downtimeCodes: ["die_change"],
    runningMin: 78,
    relief: null,
    pressRemark: null,
    dieRemark: null,
    driftKg: null,
  };
  const row = reportRowFromSnapshot("PR-38", snapshot, "night", "21:10–22:40");
  return {
    ...row,
    operator: PEOPLE.operator,
    orders: "Mehta SO-16",
    copy: "12170-2",
  };
}

export type SheetFooter = {
  inputG: number;
  goodG: number;
  recoveryBp: number | null;
  downtimeMin: number;
  downtimeCodes: string[];
};

export function sheetFooter(rows: ReportRow[]): SheetFooter | null {
  if (rows.length === 0) return null;
  const inputG = rows.reduce((sum, row) => sum + row.inputG, 0);
  const goodG = rows.reduce((sum, row) => sum + row.goodG, 0);
  return {
    inputG,
    goodG,
    recoveryBp: recoveryBp(goodG, inputG),
    downtimeMin: rows.reduce((sum, row) => sum + row.downtimeMin, 0),
    downtimeCodes: [...new Set(rows.flatMap((row) => row.downtimeCodes))],
  };
}

export function lineStatusLabel(state: PressDemoState): string {
  if (state.nothingReleased) return "idle";
  if (state.pr42.phase === "logged") return "PR-42 logged";
  if (state.pr42.phase === "running") return "PR-42 running";
  if (state.pr42.phase === "stopped") return "PR-42 stopped";
  return "PR-42 counting";
}

export function todayLoggedG(state: PressDemoState): number {
  if (state.nothingReleased) return 0;
  if (state.pr42.phase !== "logged" || !state.pr42.logged) return 0;
  return state.pr42.logged.goodG;
}

export function formatMinutes(min: number): string {
  const whole = Math.max(0, Math.round(min));
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}
