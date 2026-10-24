/** Sample plant for the platform preview. Nothing here is written to a company. */

export const PLANT = {
  name: "Fourcubes Extrusions",
  city: "Surat",
  timezone: "Asia/Kolkata",
} as const;

export const CALENDAR_DAY = 24;
export const CALENDAR_MONTH = "Oct";

/** Wall clock the landing uses until the reviewer pretends it is 07:30. */
export const CLOCK_NOW_MIN = 14 * 60 + 22;
export const CLOCK_PRETEND_MIN = 7 * 60 + 30;

export const MINUTES_PER_DAY = 1440;

export type Shift = {
  id: string;
  name: string;
  seq: number;
  startMin: number;
  endMin: number;
};

export const SAVED_SHIFTS: readonly Shift[] = [
  {
    id: "c0a1e5b2-7d44-4f1a-9b10-111111111111",
    name: "Day",
    seq: 1,
    startMin: 8 * 60,
    endMin: 20 * 60,
  },
  {
    id: "c0a1e5b2-7d44-4f1a-9b10-222222222222",
    name: "Night",
    seq: 2,
    startMin: 20 * 60,
    endMin: 8 * 60,
  },
];

export function cloneShifts(shifts: readonly Shift[] = SAVED_SHIFTS): Shift[] {
  return shifts.map((shift) => ({ ...shift }));
}

export function formatClock(minute: number): string {
  const wrapped = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(wrapped / 60);
  const min = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function shiftCovers(shift: Shift, minuteOfDay: number): boolean {
  if (shift.endMin === shift.startMin) return false;
  if (shift.endMin > shift.startMin) {
    return minuteOfDay >= shift.startMin && minuteOfDay < shift.endMin;
  }
  return minuteOfDay >= shift.startMin || minuteOfDay < shift.endMin;
}

export function shiftAt(shifts: readonly Shift[], minuteOfDay: number): Shift | undefined {
  return shifts.find((shift) => shiftCovers(shift, minuteOfDay));
}

export function shift1(shifts: readonly Shift[]): Shift | undefined {
  return shifts.find((shift) => shift.seq === 1);
}

/** Half-open minutes this shift owns. The start minute belongs to the shift that starts there. */
export function coveredMinutes(shift: Shift): number[] {
  const minutes: number[] = [];
  if (shift.endMin === shift.startMin) return minutes;
  if (shift.endMin > shift.startMin) {
    for (let minute = shift.startMin; minute < shift.endMin; minute += 1) minutes.push(minute);
    return minutes;
  }
  for (let minute = shift.startMin; minute < MINUTES_PER_DAY; minute += 1) minutes.push(minute);
  for (let minute = 0; minute < shift.endMin; minute += 1) minutes.push(minute);
  return minutes;
}

export function shiftDuration(shift: Shift): number {
  return coveredMinutes(shift).length;
}

/**
 * Drag Night's start to 07:00 and keep its length, so it runs into Day.
 * Day's end is left where it is. Touching endpoints would not be an overlap;
 * this drag shares minutes, which the checker reports.
 */
export function dragNightStartTo0700(shifts: readonly Shift[]): Shift[] {
  return shifts.map((shift) => {
    if (shift.name !== "Night") return { ...shift };
    const startMin = 7 * 60;
    const endMin = (startMin + shiftDuration(shift)) % MINUTES_PER_DAY;
    return { ...shift, startMin, endMin };
  });
}

export type ShiftIssue = {
  kind: "overlap" | "gap";
  from: number;
  to: number;
  minutes: number;
  names: string[];
};

export function checkShifts(shifts: readonly Shift[]): { ok: boolean; issues: ShiftIssue[] } {
  const owners: string[][] = Array.from({ length: MINUTES_PER_DAY }, () => []);
  for (const shift of shifts) {
    for (const minute of coveredMinutes(shift)) {
      owners[minute]?.push(shift.name);
    }
  }

  const overlapFlags = owners.map((names) => names.length > 1);
  const gapFlags = owners.map((names) => names.length === 0);
  const issues: ShiftIssue[] = [
    ...collapseRuns(overlapFlags, (minute) => owners[minute] ?? []).map((run) => ({
      kind: "overlap" as const,
      from: run.from,
      to: run.to,
      minutes: run.minutes,
      names: run.names,
    })),
    ...collapseRuns(gapFlags, () => []).map((run) => ({
      kind: "gap" as const,
      from: run.from,
      to: run.to,
      minutes: run.minutes,
      names: [],
    })),
  ];
  return { ok: issues.length === 0, issues };
}

type Run = { from: number; to: number; minutes: number; names: string[] };

function collapseRuns(flags: boolean[], namesAt: (minute: number) => string[]): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
    if (flags[minute] && start < 0) start = minute;
    if (!flags[minute] && start >= 0) {
      runs.push(runBetween(start, minute, namesAt));
      start = -1;
    }
  }
  if (start >= 0) runs.push(runBetween(start, MINUTES_PER_DAY, namesAt));
  if (runs.length >= 2 && runs[0]?.from === 0 && runs[runs.length - 1]?.to === MINUTES_PER_DAY) {
    const head = runs[0];
    const tail = runs[runs.length - 1];
    if (head && tail && sameNames(head.names, tail.names)) {
      runs.shift();
      runs.pop();
      runs.push({
        from: tail.from,
        to: head.to,
        minutes: head.minutes + tail.minutes,
        names: head.names,
      });
    }
  }
  return runs;
}

function runBetween(from: number, to: number, namesAt: (minute: number) => string[]): Run {
  const names = namesAt(from);
  return { from, to, minutes: to - from, names };
}

function sameNames(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((name, index) => name === b[index]);
}

export function rangeEndLabel(to: number): string {
  return to === MINUTES_PER_DAY ? "24:00" : formatClock(to);
}

export function productionDayCaption(minuteOfDay: number, shift1StartMin: number): string {
  const day = minuteOfDay < shift1StartMin ? CALENDAR_DAY - 1 : CALENDAR_DAY;
  return `Production day ${day} ${CALENDAR_MONTH}, from ${formatClock(shift1StartMin)}`;
}

export type DayKey = "earlier" | "23" | "24";

export type FloorBundle = {
  serial: string;
  grams: number;
  pcs: number;
  lengthFt: number;
  cast: string;
  packed: DayKey;
  /** Production day the bundle left stock. Null while it is still in stock at 14:22 on 24 Oct. */
  dispatched: "23" | "24" | null;
  packingList: string | null;
};

export const FLOOR_BUNDLES: readonly FloorBundle[] = [
  { serial: "26H2210", grams: 188_500, pcs: 30, lengthFt: 12, cast: "K28", packed: "earlier", dispatched: null, packingList: null },
  { serial: "26I3901", grams: 210_000, pcs: 36, lengthFt: 12, cast: "K29", packed: "earlier", dispatched: null, packingList: null },
  { serial: "26I4002", grams: 220_000, pcs: 40, lengthFt: 12, cast: "K30", packed: "earlier", dispatched: "23", packingList: "PL/2026-27/17" },
  { serial: "26I4086", grams: 143_200, pcs: 24, lengthFt: 12, cast: "K31", packed: "earlier", dispatched: "24", packingList: "PL/2026-27/18" },
  { serial: "26I4110", grams: 172_400, pcs: 28, lengthFt: 12, cast: "K31", packed: "23", dispatched: null, packingList: null },
  { serial: "26I4111", grams: 198_250, pcs: 34, lengthFt: 12, cast: "K31", packed: "23", dispatched: null, packingList: null },
  { serial: "26I4112", grams: 141_000, pcs: 24, lengthFt: 12, cast: "K31", packed: "23", dispatched: null, packingList: null },
  { serial: "26I4120", grams: 186_400, pcs: 32, lengthFt: 12, cast: "K31", packed: "24", dispatched: null, packingList: null },
  { serial: "26I4121", grams: 162_150, pcs: 28, lengthFt: 12, cast: "K31", packed: "24", dispatched: null, packingList: null },
  { serial: "26I4122", grams: 201_800, pcs: 36, lengthFt: 12, cast: "K31", packed: "24", dispatched: "24", packingList: "PL/2026-27/19" },
  { serial: "26I4123", grams: 154_650, pcs: 24, lengthFt: 12, cast: "K31", packed: "24", dispatched: null, packingList: null },
];

export type TodayKpis = {
  packedGrams: number;
  bundleCount: number;
  dispatchedGrams: number;
  stockGrams: number;
};

export function todayKpis(minuteOfDay: number, shift1StartMin: number, bundles: readonly FloorBundle[] = FLOOR_BUNDLES): TodayKpis {
  const previous = minuteOfDay < shift1StartMin;
  const day: "23" | "24" = previous ? "23" : "24";
  const packed = bundles.filter((bundle) => bundle.packed === day);
  const dispatched = bundles.filter((bundle) => bundle.dispatched === day);
  const inStock = bundles.filter((bundle) => (previous ? bundle.packed !== "24" && bundle.dispatched !== "23" : bundle.dispatched === null));
  return {
    packedGrams: sumGrams(packed),
    bundleCount: packed.length,
    dispatchedGrams: sumGrams(dispatched),
    stockGrams: sumGrams(inStock),
  };
}

function sumGrams(bundles: readonly FloorBundle[]): number {
  return bundles.reduce((total, bundle) => total + bundle.grams, 0);
}

export function formatKg(grams: number, digits = 2): string {
  return (grams / 1000).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Whole kilograms stay unpadded (8,000). A remainder keeps two decimals (143.20). */
export function formatKgAuto(grams: number): string {
  return formatKg(grams, grams % 1000 === 0 ? 0 : 2);
}

export function formatKgPer12(grams: number): string {
  return formatKg(grams, 3);
}

export const BHAVESH = { id: "cust-bhavesh", name: "Bhavesh Traders", city: "Ahmedabad" } as const;
export const ANSHU = { id: "cust-anshu", name: "Anshu Aluminium", city: "Rajkot" } as const;

export type ProfileKind = "solid" | "hollow" | "semi";

export type DieCopy = {
  code: string;
  latestG: number;
  ownerCustomerId: string | null;
};

export type CatalogueDie = {
  id: string;
  series: string;
  section: string;
  profileKind: ProfileKind;
  weightMinG: number;
  weightMaxG: number;
  ownerCustomerId: string | null;
  grants: readonly string[];
  copies: readonly DieCopy[];
};

export const DIES: readonly CatalogueDie[] = [
  {
    id: "die-12170",
    series: "Domal",
    section: "12170",
    profileKind: "hollow",
    weightMinG: 5_900,
    weightMaxG: 6_200,
    ownerCustomerId: null,
    grants: [BHAVESH.id],
    copies: [
      { code: "12170-1", latestG: 5_967, ownerCustomerId: null },
      { code: "12170-2", latestG: 6_480, ownerCustomerId: null },
    ],
  },
  {
    id: "die-8840",
    series: "Domal",
    section: "8840",
    profileKind: "hollow",
    weightMinG: 2_100,
    weightMaxG: 2_300,
    ownerCustomerId: ANSHU.id,
    grants: [],
    copies: [{ code: "8840-1", latestG: 2_180, ownerCustomerId: ANSHU.id }],
  },
];

export function effectiveOwner(die: CatalogueDie, copy: DieCopy): string | null {
  return copy.ownerCustomerId ?? die.ownerCustomerId;
}

export function sectionVisible(die: CatalogueDie, customerId: string): boolean {
  if (die.grants.includes(customerId)) return true;
  return die.copies.some((copy) => effectiveOwner(die, copy) === customerId);
}

export function visibleCopies(die: CatalogueDie, customerId: string): DieCopy[] {
  return die.copies.filter((copy) => {
    const owner = effectiveOwner(die, copy);
    return owner === null || owner === customerId;
  });
}

export function portalDies(customerId: string): CatalogueDie[] {
  return DIES.filter((die) => sectionVisible(die, customerId));
}

export function bandLabel(minG: number, maxG: number): string {
  return `${formatKgPer12(minG)}\u2013${formatKgPer12(maxG)}`;
}

/** Display weight when bands are off. Does not rewrite the stored band. */
export function collapsedWeightG(minG: number, maxG: number): number {
  return Math.round((minG + maxG) / 2);
}

export function overBandG(latestG: number, maxG: number): number {
  return latestG - maxG;
}

export function inBand(latestG: number, minG: number, maxG: number): boolean {
  return latestG >= minG && latestG <= maxG;
}

export type StandardPair = { standard: string; cml: string };

export const STANDARDS: { solid: StandardPair; hollow: StandardPair; semi: StandardPair } = {
  solid: { standard: "IS 733", cml: "CM/L-0000112170" },
  hollow: { standard: "IS 1285", cml: "CM/L-0000112171" },
  semi: { standard: "", cml: "" },
};

export const DEMO_LICENCE_LABEL = "Demo licence — replace before print";

export function pairBlank(pair: StandardPair): boolean {
  return pair.standard.trim() === "" && pair.cml.trim() === "";
}

export const BHAVESH_ORDER = {
  number: "SO-18",
  status: "confirmed" as const,
  series: "Domal",
  section: "12170",
  lengthFt: 12,
  orderedG: 1_193_400,
  dispatchedG: 0,
};

export function bakiGrams(orderedG: number, dispatchedG: number): number {
  return orderedG - dispatchedG;
}

export const BOOKING_NUMBER = "SO-20";
export const BOOKING_PCS = 20;
export const BOOKING_LENGTH_FT = 12;
export const OFFICE_WILL_CONFIRM = "Office will confirm";

export const PORTAL_DISPATCH = {
  number: "PL/2026-27/18",
  status: "completed" as const,
  vehicle: "GJ-05-FT-4821",
};

export const CERTIFICATE = {
  number: "TC/2026-27/4",
  revision: 1,
  profileKind: "hollow" as const,
  standard: "IS 1285",
  cml: "CM/L-0000112171",
  dispatch: "PL/2026-27/18",
};

export const FIXTURE_PDF_TOAST = "Preview only — nothing downloaded";

export const RATE_PAISE_PER_KG = 42_500;

export function lineTotalPaise(grams: number, paisePerKg: number): number {
  return Math.round((grams * paisePerKg) / 1000);
}

export function formatInrPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatRatePerKg(paisePerKg: number): string {
  return `₹${(paisePerKg / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}/kg`;
}

export type Attachment = "none" | "copy" | "tier";

export function confirmOrder(dieRequired: boolean, attachment: Attachment): { ok: boolean; message: string } {
  if (dieRequired && attachment === "none") {
    return { ok: false, message: "Confirm needs a die copy or a tier." };
  }
  if (attachment === "copy") {
    return {
      ok: true,
      message: dieRequired
        ? "Confirmed with die copy 12170-1."
        : "Confirmed on section Domal 12170. Die copy 12170-1 is attached, and it was not required.",
    };
  }
  if (attachment === "tier") {
    return {
      ok: true,
      message: dieRequired
        ? "Confirmed with tier T2."
        : "Confirmed on section Domal 12170. Tier T2 is attached, and it was not required.",
    };
  }
  return { ok: true, message: "Confirmed on section Domal 12170." };
}

export const BOUGHT_MODULES: readonly { id: string; label: string; on: boolean }[] = [
  { id: "customers", label: "Customers", on: true },
  { id: "dies", label: "Dies", on: true },
  { id: "bundles", label: "Bundles", on: true },
  { id: "dispatches", label: "Dispatches", on: true },
  { id: "orders", label: "Orders", on: true },
  { id: "foundry", label: "Foundry", on: true },
  { id: "press", label: "Press", on: true },
  { id: "ageing", label: "Ageing", on: true },
  { id: "store", label: "Store", on: true },
  { id: "purchase", label: "Purchase", on: false },
];

export const BACKUP_EXPORT = {
  status: "ok" as const,
  at: "23 Oct, 02:10 IST",
  bytes: 48 * 1024 * 1024,
};

export const BACKUP_DRILL = {
  status: "ok" as const,
  at: "12 Oct",
  scratch: "restore-drill-2026-10-12",
};

export const DRILL_RERUN = {
  status: "ok" as const,
  at: "24 Oct",
  scratch: "restore-drill-2026-10-24",
};

export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString("en-IN", { maximumFractionDigits: 0 })} MB`;
}

export const APP_ID = "in.orrn.app";
export const MIN_BUILD = 12;
export const RELEASE_NOTES = "Floor: Gujarati pack labels";
export const LATEST_BUILD = 14;
export const LATEST_VERSION = "1.4.0";

export type Install = {
  id: string;
  kind: "tablet" | "phone";
  label: string;
  person: string;
  role: "packer";
  version: string;
  build: number;
  lastSeenDay: number;
  lastSeenMin: number;
  platform: "android";
};

export const INSTALLS: readonly Install[] = [
  {
    id: "inst-tablet",
    kind: "tablet",
    label: "Floor tablet",
    person: "Ramesh Patel",
    role: "packer",
    version: LATEST_VERSION,
    build: LATEST_BUILD,
    lastSeenDay: 24,
    lastSeenMin: 11 * 60 + 40,
    platform: "android",
  },
  {
    id: "inst-phone",
    kind: "phone",
    label: "Packer phone",
    person: "Meena Shah",
    role: "packer",
    version: "1.2.4",
    build: 9,
    lastSeenDay: 22,
    lastSeenMin: 18 * 60 + 12,
    platform: "android",
  },
];

export function belowMinimum(build: number, minBuild: number = MIN_BUILD): boolean {
  return build < minBuild;
}

export function seenThisProductionDay(install: Install, shift1StartMin: number): boolean {
  return install.lastSeenDay === CALENDAR_DAY && install.lastSeenMin >= shift1StartMin;
}

export function formatSeen(install: Install): string {
  return `${install.lastSeenDay} ${CALENDAR_MONTH}, ${formatClock(install.lastSeenMin)}`;
}

export type PreviewLocale = "en" | "hi" | "gu";

export type ChromeStrings = Record<
  "today" | "day" | "night" | "settings" | "dispatch" | "stock",
  string
>;

export const CHROME: Record<PreviewLocale, ChromeStrings> = {
  en: {
    today: "Today",
    day: "Day",
    night: "Night",
    settings: "Settings",
    dispatch: "Dispatch",
    stock: "Stock",
  },
  hi: {
    today: "आज",
    day: "दिन",
    night: "रात",
    settings: "सेटिंग्स",
    dispatch: "डिस्पैच",
    stock: "स्टॉक",
  },
  gu: {
    today: "આજે",
    day: "દિવસ",
    night: "રાત",
    settings: "સેટિંગ્સ",
    dispatch: "ડિસ્પેચ",
    stock: "સ્ટોક",
  },
};

export function chromeFor(locale: PreviewLocale): ChromeStrings {
  return CHROME[locale];
}

export function shiftChromeName(name: string, chrome: ChromeStrings): string {
  if (name === "Day") return chrome.day;
  if (name === "Night") return chrome.night;
  return name;
}
