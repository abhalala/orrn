/**
 * Fixture day: Fourcubes Extrusions, Surat, 24 Oct 2026. Weights are integer grams.
 * Chemistry is integer ppm. Display percent = ppm / 10_000, three decimals.
 * Burn and yield follow the foundry spec, not a typed residual.
 *
 * The open cast is K31 and the next number is K32, as the demo brief states.
 * `formatCastCode(10, 32)` would print J32 (I = Sep). This preview continues
 * the book the brief names, it does not re-letter October.
 */



export const PLANT = "Fourcubes Extrusions, Surat";
export const BOOK_DATE = "2026-10-24";
export const CAST_YEAR = 2026;
export const SERIES_START_SEQ = 32;
export const BURN_WARN_BP = 300;
export const SPEC_PATH = "docs/superpowers/specs/2026-10-24-orrn-fp-foundry-design.md";

export const CASTS_FEATURE_IDS = ["FP-FD-01", "FP-FD-02", "FP-FD-03", "FP-FD-08", "FP-FD-10", "FP-FD-14"] as const;
export const CAST_FEATURE_IDS = [
  "FP-FD-01",
  "FP-FD-03",
  "FP-FD-04",
  "FP-FD-05",
  "FP-FD-06",
  "FP-FD-07",
  "FP-FD-08",
  "FP-FD-09",
  "FP-FD-10",
  "FP-FD-11",
  "FP-FD-13",
] as const;
export const STOCK_FEATURE_IDS = ["FP-FD-07", "FP-FD-13", "FP-FD-15"] as const;
export const CERTIFICATE_FEATURE_IDS = ["FP-FD-09", "FP-FD-10", "FP-FD-16", "FP-FD-18"] as const;

export const FURNACE = {
  code: "F1",
  name: "Furnace 1",
  capacityG: 6_000_000,
  diameterMm: 127,
} as const;

export const ELEMENTS = ["si", "fe", "cu", "mn", "mg", "zn", "ti", "cr", "al"] as const;
export type ElementCode = (typeof ELEMENTS)[number];
export const REQUIRED_ELEMENTS = ["si", "fe", "cu", "mn", "mg", "zn", "ti", "cr"] as const;
export type RequiredElement = (typeof REQUIRED_ELEMENTS)[number];

export const ELEMENT_LABEL: Record<ElementCode, string> = {
  si: "Si",
  fe: "Fe",
  cu: "Cu",
  mn: "Mn",
  mg: "Mg",
  zn: "Zn",
  ti: "Ti",
  cr: "Cr",
  al: "Al",
};

export const ALLOY_CODES = ["6063", "6061"] as const;
export type AlloyCode = (typeof ALLOY_CODES)[number];

export type AlloyLimit = {
  element: ElementCode;
  minPpm: number | null;
  maxPpm: number | null;
};

const KG_WHOLE = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const PCT1 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PCT3 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function percentToPpm(percent: number): number {
  return Math.round(percent * 10_000);
}

export function formatPercentFromPpm(ppm: number): string {
  return PCT3.format(ppm / 10_000);
}

export function formatPercentFromBp(bp: number): string {
  return `${PCT1.format(bp / 100)}%`;
}

export function formatKgFromG(g: number): string {
  const kg = g / 1000;
  if (Number.isInteger(kg)) return KG_WHOLE.format(kg);
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kg);
}

export function formatKgValue(kg: number, digits: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(kg);
}

export function formatBookDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const monthIndex = Number(month) - 1;
  const name = MONTHS[monthIndex] ?? month;
  return `${Number(day)} ${name} ${year}`;
}

export function formatInches(mm: number): string {
  const inches = mm / 25.4;
  const rounded = Math.round(inches * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function nextCastNumber(seq: number): string {
  return `K${seq}`;
}

const MONTH_LETTER_NUMBER = /^[A-L][0-9]+$/;

export function isMonthLetterNumber(code: string): boolean {
  return MONTH_LETTER_NUMBER.test(code.trim().toUpperCase());
}

function limit(minPercent: number | null, maxPercent: number | null): Pick<AlloyLimit, "minPpm" | "maxPpm"> {
  return {
    minPpm: minPercent == null ? null : percentToPpm(minPercent),
    maxPpm: maxPercent == null ? null : percentToPpm(maxPercent),
  };
}

function alloyLimits(
  rows: Record<ElementCode, { min: number | null; max: number | null }>,
): AlloyLimit[] {
  return ELEMENTS.map((element) => ({
    element,
    ...limit(rows[element].min, rows[element].max),
  }));
}

export const ALLOY_LIMITS: Record<AlloyCode, AlloyLimit[]> = {
  "6063": alloyLimits({
    si: { min: 0.2, max: 0.6 },
    fe: { min: null, max: 0.35 },
    cu: { min: null, max: 0.1 },
    mn: { min: null, max: 0.1 },
    mg: { min: 0.45, max: 0.9 },
    zn: { min: null, max: 0.1 },
    ti: { min: null, max: 0.1 },
    cr: { min: null, max: 0.1 },
    al: { min: null, max: null },
  }),
  "6061": alloyLimits({
    si: { min: 0.4, max: 0.8 },
    fe: { min: null, max: 0.7 },
    cu: { min: 0.15, max: 0.4 },
    mn: { min: null, max: 0.15 },
    mg: { min: 0.8, max: 1.2 },
    zn: { min: null, max: 0.25 },
    ti: { min: null, max: 0.15 },
    cr: { min: 0.04, max: 0.35 },
    al: { min: null, max: null },
  }),
};

export function formatLimitRange(minPpm: number | null, maxPpm: number | null): string {
  if (minPpm == null && maxPpm == null) return "remainder";
  const min = minPpm == null ? null : formatPercentFromPpm(minPpm);
  const max = maxPpm == null ? null : formatPercentFromPpm(maxPpm);
  if (min && max) return `${min}–${max}`;
  if (max) return `– ${max}`;
  return `${min} –`;
}

export type LotCharge = {
  id: string;
  kind: "lot";
  lotNo: string;
  vendor: string;
  city: string;
  item: string;
  grade: string;
  kgG: number;
};

export type StreamCharge = {
  id: string;
  kind: "return_stream";
  stream: string;
  streamCode: string;
  kgG: number;
};

export type ChargeLine = LotCharge | StreamCharge;

export const K31_CHARGE: ChargeLine[] = [
  {
    id: "lot-41",
    kind: "lot",
    lotNo: "LOT-41",
    vendor: "K.D. Metals",
    city: "Rajkot",
    item: "imp belling",
    grade: "A",
    kgG: 4_820_000,
  },
  {
    id: "lot-44",
    kind: "lot",
    lotNo: "LOT-44",
    vendor: "Jay Ambe Scrap Co.",
    city: "Rajkot",
    item: "soft cable",
    grade: "A+",
    kgG: 1_150_000,
  },
  {
    id: "plant-scrap",
    kind: "return_stream",
    stream: "Plant scrap",
    streamCode: "plant_scrap",
    kgG: 180_000,
  },
];

export const K31_STORE = {
  item: "Cover flux",
  kgG: 12_000,
  mrs: "MRS-18",
} as const;

export const K31_LDO = {
  startInches: 42,
  endInches: 37,
} as const;

export const K31_LOG = {
  pcs: 48,
  logLengthFt: 12,
  billetLengthFt: 12,
  diameterMm: FURNACE.diameterMm,
  kgG: 5_860_000,
} as const;

export const K31_DROSS_G = 96_000;
export const K31_IRON_G = 18_000;
export const K31_CREDITED_G = 0;

export const H24_LOGS_G = 11_400_000;
export const H24_METAL_IN_G = 12_115_000;
export const H24_ON_HAND_G = 860_000;
export const H24_CREDITED_G = 10_540_000;

export const K31_TIMES = {
  preheatStart: "06:00",
  chargingStart: "07:10",
  chargingEnd: "08:40",
  castingStart: "14:20",
  castingEnd: "17:05",
} as const;

export const SPECTRO_FILE = "spectro-K31.pdf";

export const K31_TYPED_PERCENT: Record<RequiredElement, number> = {
  si: 0.42,
  fe: 0.18,
  cu: 0.02,
  mn: 0.03,
  mg: 0.52,
  zn: 0.01,
  ti: 0.02,
  cr: 0.01,
};

export const FAIL_FE_PERCENT = 0.41;

export type ElementVerdict = "pass" | "fail" | "no_limit";
export type ResultVerdict = "pass" | "fail" | "incomplete";

export type SpectroRow = {
  element: ElementCode;
  label: string;
  ppm: number;
  source: "typed" | "balance";
  minPpm: number | null;
  maxPpm: number | null;
  verdict: ElementVerdict;
};

export type SpectroSheet = {
  rows: SpectroRow[];
  verdict: ResultVerdict;
  alSource: "balance";
};

export function elementVerdict(ppm: number, minPpm: number | null, maxPpm: number | null): ElementVerdict {
  if (minPpm == null && maxPpm == null) return "no_limit";
  if (minPpm != null && ppm < minPpm) return "fail";
  if (maxPpm != null && ppm > maxPpm) return "fail";
  return "pass";
}

export function buildSpectro(alloy: AlloyCode, failFe: boolean): SpectroSheet {
  const limits = ALLOY_LIMITS[alloy];
  const limitByElement = new Map(limits.map((row) => [row.element, row]));
  const typed = REQUIRED_ELEMENTS.map((element) => {
    const percent = element === "fe" && failFe ? FAIL_FE_PERCENT : K31_TYPED_PERCENT[element];
    return { element, ppm: percentToPpm(percent) };
  });
  const otherPpm = typed.reduce((sum, row) => sum + row.ppm, 0);
  const alPpm = Math.max(0, 1_000_000 - otherPpm);
  const readings: { element: ElementCode; ppm: number; source: "typed" | "balance" }[] = [
    ...typed.map((row) => ({ ...row, source: "typed" as const })),
    { element: "al", ppm: alPpm, source: "balance" as const },
  ];
  const rows: SpectroRow[] = readings.map((reading) => {
    const bounds = limitByElement.get(reading.element);
    const minPpm = bounds?.minPpm ?? null;
    const maxPpm = bounds?.maxPpm ?? null;
    return {
      element: reading.element,
      label: ELEMENT_LABEL[reading.element],
      ppm: reading.ppm,
      source: reading.source,
      minPpm,
      maxPpm,
      verdict: elementVerdict(reading.ppm, minPpm, maxPpm),
    };
  });
  const missing = REQUIRED_ELEMENTS.some((element) => !rows.some((row) => row.element === element));
  const failed = rows.some((row) => row.verdict === "fail");
  const verdict: ResultVerdict = failed ? "fail" : missing ? "incomplete" : "pass";
  return { rows, verdict, alSource: "balance" };
}

export type MeltBalance = {
  metalInG: number;
  logsG: number;
  drossG: number;
  ironG: number;
  outG: number;
  burnG: number;
  balanceBp: number;
  yieldBp: number;
  outside3: boolean;
  overCapacity: boolean;
  overG: number;
  capacityPctBp: number;
};

export function meltBalance(input: {
  charge: ChargeLine[];
  logsG: number;
  drossG: number;
  ironG: number;
  capacityG: number;
}): MeltBalance {
  const metalInG = input.charge.reduce((sum, line) => sum + line.kgG, 0);
  const outG = input.logsG + input.drossG + input.ironG;
  const burnG = metalInG - outG;
  const balanceBp = metalInG === 0 ? 0 : Math.round((burnG * 10_000) / metalInG);
  const yieldBp = metalInG === 0 ? 0 : Math.round((input.logsG * 10_000) / metalInG);
  const overG = Math.max(0, metalInG - input.capacityG);
  const capacityPctBp = input.capacityG === 0 ? 0 : Math.round((metalInG * 10_000) / input.capacityG);
  return {
    metalInG,
    logsG: input.logsG,
    drossG: input.drossG,
    ironG: input.ironG,
    outG,
    burnG,
    balanceBp,
    yieldBp,
    outside3: Math.abs(balanceBp) > BURN_WARN_BP,
    overCapacity: metalInG > input.capacityG,
    overG,
    capacityPctBp,
  };
}

export function k31Balance(drossZeroed: boolean): MeltBalance {
  return meltBalance({
    charge: K31_CHARGE,
    logsG: K31_LOG.kgG,
    drossG: drossZeroed ? 0 : K31_DROSS_G,
    ironG: K31_IRON_G,
    capacityG: FURNACE.capacityG,
  });
}

export function clockMinutes(hhmm: string): number {
  const [hourText, minuteText] = hhmm.split(":");
  const hours = Number(hourText);
  const minutes = Number(minuteText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return 0;
  return hours * 60 + minutes;
}

export function minutesBetween(start: string, end: string): number {
  return clockMinutes(end) - clockMinutes(start);
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  if (hours === 0) return `${sign}${rest} min`;
  if (rest === 0) return `${sign}${hours} h`;
  return `${sign}${hours} h ${rest} min`;
}

export function kgPerPiece(kgG: number, pcs: number): number | null {
  if (!(pcs > 0)) return null;
  return kgG / pcs / 1000;
}

export type CastListStatus = "open" | "closed";

export type CastListRow = {
  id: string;
  number: string;
  year: number;
  openedOn: string;
  alloy: AlloyCode;
  furnace: string | null;
  melts: number;
  metalInG: number | null;
  logsG: number;
  onHandG: number;
  yieldBp: number | null;
  spectroLabel: string;
  spectroNote?: string;
  spectroTone: "green" | "red" | "neutral";
  status: CastListStatus;
  href: "/preview/foundry/cast" | "/preview/foundry/stock" | null;
};

export type OpenedCast = {
  id: string;
  number: string;
  numberSource: "series" | "manual";
  openedOn: string;
  alloy: AlloyCode;
  year: number;
};

const K31_RESTING = k31Balance(false);

export function k31ListRow(locked: boolean): CastListRow {
  return {
    id: "cast-k31",
    number: "K31",
    year: CAST_YEAR,
    openedOn: BOOK_DATE,
    alloy: "6063",
    furnace: FURNACE.code,
    melts: 1,
    metalInG: K31_RESTING.metalInG,
    logsG: K31_LOG.kgG,
    onHandG: locked ? K31_LOG.kgG - K31_CREDITED_G : 0,
    yieldBp: K31_RESTING.yieldBp,
    spectroLabel: "Pass",
    spectroTone: "green",
    status: "open",
    href: "/preview/foundry/cast",
  };
}

export function h24ListRow(): CastListRow {
  return {
    id: "cast-h24",
    number: "H24",
    year: CAST_YEAR,
    openedOn: "2026-08-18",
    alloy: "6061",
    furnace: FURNACE.code,
    melts: 2,
    metalInG: H24_METAL_IN_G,
    logsG: H24_LOGS_G,
    onHandG: H24_ON_HAND_G,
    yieldBp: Math.round((H24_LOGS_G * 10_000) / H24_METAL_IN_G),
    spectroLabel: "Fail",
    spectroNote: "melt 2 · Fe",
    spectroTone: "red",
    status: "closed",
    href: "/preview/foundry/stock",
  };
}

export function openedCastRow(cast: OpenedCast): CastListRow {
  return {
    id: cast.id,
    number: cast.number,
    year: cast.year,
    openedOn: cast.openedOn,
    alloy: cast.alloy,
    furnace: null,
    melts: 0,
    metalInG: 0,
    logsG: 0,
    onHandG: 0,
    yieldBp: null,
    spectroLabel: "No spectro",
    spectroTone: "neutral",
    status: "open",
    href: null,
  };
}

export function castListRows(opened: OpenedCast[], k31Locked: boolean): CastListRow[] {
  return [...opened.map(openedCastRow).reverse(), k31ListRow(k31Locked), h24ListRow()];
}

export const BOOKED_NUMBERS = ["K31", "H24"] as const;

export type StockCast = {
  id: string;
  alloy: AlloyCode;
  number: string;
  pcs: number;
  pcsLabel: string;
  lengthFt: number;
  diameterMm: number | null;
  onHandG: number;
  creditedG: number;
  logsG: number;
  posted: boolean;
  href: "/preview/foundry/cast" | null;
  creditedCaption: string | null;
};

export function stockCastRows(k31Locked: boolean): StockCast[] {
  return [
    {
      id: "stock-k31",
      alloy: "6063",
      number: "K31",
      pcs: K31_LOG.pcs,
      pcsLabel: `${K31_LOG.pcs} pcs`,
      lengthFt: K31_LOG.logLengthFt,
      diameterMm: K31_LOG.diameterMm,
      onHandG: k31Locked ? K31_LOG.kgG : 0,
      creditedG: 0,
      logsG: k31Locked ? K31_LOG.kgG : 0,
      posted: k31Locked,
      href: "/preview/foundry/cast",
      creditedCaption: null,
    },
    {
      id: "stock-h24",
      alloy: "6061",
      number: "H24",
      pcs: 6,
      pcsLabel: "6 pcs left",
      lengthFt: 12,
      diameterMm: null,
      onHandG: H24_ON_HAND_G,
      creditedG: H24_CREDITED_G,
      logsG: H24_LOGS_G,
      posted: true,
      href: null,
      creditedCaption: "credited when the press run is logged",
    },
  ];
}

export function tailG(row: Pick<StockCast, "logsG" | "onHandG" | "creditedG">): number {
  return row.logsG - row.onHandG - row.creditedG;
}

export const SECTION = {
  code: "12170",
  name: "Domal",
  bandMinKg: 5.9,
  bandMaxKg: 6.2,
} as const;

export function insideBand(kgPer12ft: number): boolean {
  return kgPer12ft >= SECTION.bandMinKg && kgPer12ft <= SECTION.bandMaxKg;
}

export type CertificateBundle = {
  serial: string;
  section: string;
  lengthFt: number;
  pcs: number;
  kgG: number;
  kgPer12ft: number;
  customer: string;
  city: string;
  po: string;
};

export const CERTIFICATE_BUNDLES: CertificateBundle[] = [
  {
    serial: "26J1842",
    section: "12170 Domal",
    lengthFt: 12,
    pcs: 21,
    kgG: 143_200,
    kgPer12ft: 6.819,
    customer: "Royal Aluminium",
    city: "Rajkot",
    po: "PO 31",
  },
  {
    serial: "26J1843",
    section: "12170 Domal",
    lengthFt: 12,
    pcs: 18,
    kgG: 124_600,
    kgPer12ft: 6.922,
    customer: "Tejura & Sons",
    city: "Morbi",
    po: "PO 18",
  },
];

export function verdictWord(verdict: ResultVerdict | ElementVerdict): string {
  if (verdict === "pass") return "Pass";
  if (verdict === "fail") return "Fail";
  if (verdict === "incomplete") return "Incomplete";
  return "No limit";
}

export function verdictTone(verdict: ResultVerdict | ElementVerdict): "green" | "red" | "amber" | "neutral" {
  if (verdict === "pass") return "green";
  if (verdict === "fail") return "red";
  if (verdict === "incomplete") return "amber";
  return "neutral";
}
