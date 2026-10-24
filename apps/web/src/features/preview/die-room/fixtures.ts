/**
 * Die-room preview fixtures. Weights are grams per 12 ft, the same integer
 * as `kg_per_12ft_milli`. Nothing here is stored kg/m or a cached percent.
 *
 * kg/m is `(milli / 1000) / (12 × 0.3048)`, half-up to 3 decimals.
 * 5.967 / 3.6576 = 1.631397…, so the chip is 1.631, not 1.632.
 */

export const DEMO_DAY = "24 Oct 2026";
export const SPEC_PATH = "docs/superpowers/specs/2026-10-24-orrn-fp-die-room-design.md";

export const DRIFT_GREEN_MAX_BP = 800;
export const DRIFT_AMBER_MAX_BP = 1000;

/** 12 × 0.3048 × 10_000, so kg/m thousandths = round(milli × 10_000 / this). */
const METRE_12FT_SCALED = 36_576;

export type CopyStatus = "available" | "in_use" | "at_nitriding" | "at_maker" | "retired";
export type DriftTone = "none" | "under" | "green" | "amber" | "red";
export type BandPosition = "in" | "above" | "below";
export type ProfileKind = "hollow" | "solid" | "semi";
export type MakerPurpose = "trial" | "correction" | "repair";

export type Band = {
  id: string;
  label: string | null;
  wallTenthMm: number;
  weightMinG: number;
  weightMaxG: number;
  active: boolean;
  primary: boolean;
};

export type WeightReading = {
  id: string;
  kgPer12ftMilli: number;
  at: string;
  pressRunId: string | null;
};

export type DieCopy = {
  id: string;
  code: string;
  seqNo: number;
  status: CopyStatus;
  tierRank: number;
  /** Null means the section's primary band. */
  bandId: string | null;
  rackNo: string | null;
  bolster: string | null;
  backerNo: string | null;
  subBolster: string | null;
  cavityCount: number;
  trialMilli: number | null;
  hardnessHv: number | null;
  /** Life in grams. 8,000 kg = 8_000_000. */
  lifeG: number | null;
  ftr: string | null;
  supplier: string | null;
  corrector: string | null;
  receivedOn: string | null;
  /** Oldest first. Latest reading is the last row. Trial is not a reading. */
  readings: WeightReading[];
};

export type Section = {
  id: string;
  series: string;
  sectionCode: string;
  name: string;
  profileKind: ProfileKind;
  alloy: string;
  temper: string;
  wallTenthMm: number;
  cavityCount: number;
  ownerName: string | null;
  ownerCity: string | null;
  drawingFilename: string | null;
  primary: Band;
  bands: Band[];
  copies: DieCopy[];
};

export type PressRunRow = {
  id: string;
  number: string;
  shift: string;
  date: string;
  inG: number;
  outG: number;
  /** Tenths of mm/s. 85 = 8.5. */
  speedTenthMmPerS: number;
  readingMilli: number;
  nitridingDate: string | null;
  remark: string;
};

export type NitridingChemical = {
  name: string;
  openG: number;
  usedG: number;
};

export type NitridingRow = {
  id: string;
  date: string;
  hardnessHv: number;
  signedBy: string;
  chemicals: NitridingChemical[];
};

export type DieFile = {
  id: string;
  kind: "image" | "pdf" | "cdr" | "dwg";
  filename: string;
  bytes: number;
  pressDrawing: boolean;
};

export type MakerJob = {
  number: string;
  copyCode: string;
  makerName: string;
  city: string;
  purpose: MakerPurpose;
  sentOn: string;
  status: "sent" | "received" | "cancelled";
};

export const PLANT = { name: "Fourcubes Extrusions", city: "Surat" } as const;

export const PRESS_LINES = [
  { id: "line-1", name: "Press 1" },
  { id: "line-2", name: "Press 2" },
] as const;

export const PARTIES = {
  bhavesh: { name: "Bhavesh Traders", city: "Ahmedabad" },
  anshu: { name: "Anshu Aluminium", city: "Rajkot" },
} as const;

export const LIFT_REASON = "Web has worn; still sound for the heavier band.";

const primary12170: Band = {
  id: "primary-12170",
  label: null,
  wallTenthMm: 12,
  weightMinG: 5900,
  weightMaxG: 6200,
  active: true,
  primary: true,
};

const heavy12170: Band = {
  id: "band-12170-heavy",
  label: "6.2–6.6",
  wallTenthMm: 14,
  weightMinG: 6200,
  weightMaxG: 6600,
  active: true,
  primary: false,
};

const primary31220: Band = {
  id: "primary-31220",
  label: null,
  wallTenthMm: 18,
  weightMinG: 12_000,
  weightMaxG: 12_500,
  active: true,
  primary: true,
};

export const SECTIONS: Section[] = [
  {
    id: "sec-12170",
    series: "Domal",
    sectionCode: "12170",
    name: "12170 Domal",
    profileKind: "hollow",
    alloy: "6063",
    temper: "T6",
    wallTenthMm: 12,
    cavityCount: 2,
    ownerName: null,
    ownerCity: null,
    drawingFilename: "12170-domal.pdf",
    primary: primary12170,
    bands: [heavy12170],
    copies: [
      {
        id: "copy-12170-1",
        code: "12170-1",
        seqNo: 1,
        status: "in_use",
        tierRank: 1,
        bandId: null,
        rackNo: "A-12",
        bolster: "B-4",
        backerNo: "BK-12",
        subBolster: "SB-2",
        cavityCount: 2,
        trialMilli: 5910,
        hardnessHv: 1050,
        lifeG: 8_000_000,
        ftr: "FTR",
        supplier: "Prime Tooling",
        corrector: "R. Patel",
        receivedOn: "4 Mar 2026",
        readings: [
          { id: "rd-18", kgPer12ftMilli: 5940, at: "12 Oct 2026", pressRunId: "PR-18" },
          { id: "rd-41", kgPer12ftMilli: 5967, at: "22 Oct 2026", pressRunId: "PR-41" },
        ],
      },
      {
        id: "copy-12170-2",
        code: "12170-2",
        seqNo: 2,
        status: "available",
        tierRank: 2,
        bandId: null,
        rackNo: "A-14",
        bolster: "B-4",
        backerNo: null,
        subBolster: null,
        cavityCount: 2,
        trialMilli: 5920,
        hardnessHv: 1040,
        lifeG: 8_000_000,
        ftr: "FTR",
        supplier: "Prime Tooling",
        corrector: null,
        receivedOn: "11 Jun 2026",
        readings: [{ id: "rd-2", kgPer12ftMilli: 6480, at: "21 Oct 2026", pressRunId: null }],
      },
      {
        id: "copy-12170-3",
        code: "12170-3",
        seqNo: 3,
        status: "at_maker",
        tierRank: 3,
        bandId: null,
        rackNo: "A-18",
        bolster: null,
        backerNo: null,
        subBolster: null,
        cavityCount: 2,
        trialMilli: null,
        hardnessHv: null,
        lifeG: 8_000_000,
        ftr: null,
        supplier: null,
        corrector: null,
        receivedOn: null,
        readings: [],
      },
    ],
  },
  {
    id: "sec-31220",
    series: "Sliding",
    sectionCode: "31220",
    name: "31220 Sliding",
    profileKind: "solid",
    alloy: "6061",
    temper: "T6",
    wallTenthMm: 18,
    cavityCount: 1,
    ownerName: PARTIES.bhavesh.name,
    ownerCity: PARTIES.bhavesh.city,
    drawingFilename: null,
    primary: primary31220,
    bands: [],
    copies: [
      {
        id: "copy-31220-1",
        code: "31220-1",
        seqNo: 1,
        status: "available",
        tierRank: 1,
        bandId: null,
        rackNo: "C-3",
        bolster: "B-1",
        backerNo: null,
        subBolster: null,
        cavityCount: 1,
        trialMilli: 12_040,
        hardnessHv: 980,
        lifeG: 6_000_000,
        ftr: "FTR",
        supplier: "Shreeji Dies",
        corrector: null,
        receivedOn: "2 Jan 2026",
        readings: [{ id: "rd-31220", kgPer12ftMilli: 12_180, at: "19 Oct 2026", pressRunId: null }],
      },
    ],
  },
];

export const RUNS_12170_1: PressRunRow[] = [
  {
    id: "PR-18",
    number: "PR-18",
    shift: "Day",
    date: "12 Oct 2026",
    inG: 420_000,
    outG: 336_420,
    speedTenthMmPerS: 85,
    readingMilli: 5940,
    nitridingDate: null,
    remark: "Clean pull.",
  },
  {
    id: "PR-41",
    number: "PR-41",
    shift: "Night",
    date: "22 Oct 2026",
    inG: 510_000,
    outG: 389_130,
    speedTenthMmPerS: 72,
    readingMilli: 5967,
    nitridingDate: "2 Sep 2026",
    remark: "Slight flow on the web.",
  },
];

export const NITRIDING_12170_1: NitridingRow = {
  id: "nit-12170-1",
  date: "2 Sep 2026",
  hardnessHv: 1050,
  signedBy: "Die room",
  chemicals: [{ name: "CR4", openG: 2000, usedG: 180 }],
};

export const FILES_12170: DieFile[] = [
  { id: "file-pdf", kind: "pdf", filename: "12170-domal.pdf", bytes: 184_320, pressDrawing: true },
  { id: "file-photo", kind: "image", filename: "12170-face.jpg", bytes: 245_760, pressDrawing: false },
  { id: "file-cdr", kind: "cdr", filename: "12170-domal.cdr", bytes: 512_000, pressDrawing: false },
  { id: "file-dwg", kind: "dwg", filename: "12170-domal.dwg", bytes: 876_544, pressDrawing: false },
];

export const JOB_DM4: MakerJob = {
  number: "DM-4",
  copyCode: "12170-3",
  makerName: "Shreeji Dies",
  city: "Vatva",
  purpose: "correction",
  sentOn: "18 Oct 2026",
  status: "sent",
};

export function sectionByCode(code: string): Section {
  const found = SECTIONS.find((section) => section.sectionCode === code);
  if (!found) throw new Error(`Missing fixture section ${code}`);
  return found;
}

export function copyByCode(code: string): { section: Section; copy: DieCopy } {
  for (const section of SECTIONS) {
    const copy = section.copies.find((row) => row.code === code);
    if (copy) return { section, copy };
  }
  throw new Error(`Missing fixture copy ${code}`);
}

export function allBands(section: Section, added: Band[] = []): Band[] {
  return [section.primary, ...section.bands, ...added];
}

export function effectiveBand(section: Section, copy: DieCopy, added: Band[] = []): Band {
  if (copy.bandId) {
    const found = allBands(section, added).find((band) => band.id === copy.bandId && band.active);
    if (found) return found;
  }
  return section.primary;
}

export function latestMilli(copy: DieCopy): number | null {
  const last = copy.readings[copy.readings.length - 1];
  return last ? last.kgPer12ftMilli : null;
}

/** Half away from zero. Remainder of exactly 1/2 rounds away from zero. */
export function divRoundHalfAway(num: number, den: number): number {
  if (den <= 0) return 0;
  const neg = num < 0;
  const abs = Math.abs(num);
  const q = Math.floor(abs / den);
  const r = abs % den;
  const rounded = r * 2 >= den ? q + 1 : q;
  return neg ? -rounded : rounded;
}

/** Tenths of a percent vs band start. +1.1% is 11. */
export function pctTenth(latestMilliG: number, bandStartG: number): number {
  return divRoundHalfAway((latestMilliG - bandStartG) * 1000, bandStartG);
}

/** Thousandths of a kg/m. 1631 = 1.631 kg/m. */
export function kgPerMThousandths(milli: number): number {
  return divRoundHalfAway(milli * 10_000, METRE_12FT_SCALED);
}

export function driftTone(
  latest: number | null,
  bandStartG: number,
  greenBp = DRIFT_GREEN_MAX_BP,
  amberBp = DRIFT_AMBER_MAX_BP,
): DriftTone {
  if (latest === null) return "none";
  if (latest < bandStartG) return "under";
  const bp = pctTenth(latest, bandStartG) * 10;
  if (bp <= greenBp) return "green";
  if (bp <= amberBp) return "amber";
  return "red";
}

export function bandPosition(latest: number | null, band: Band): BandPosition | null {
  if (latest === null) return null;
  if (latest < band.weightMinG) return "below";
  if (latest > band.weightMaxG) return "above";
  return "in";
}

export function gramsOffMax(latest: number, band: Band): number {
  return latest - band.weightMaxG;
}

/** Recovery in tenths of a percent. 801 = 80.1%. */
export function recoveryTenths(outG: number, inG: number): number {
  if (inG <= 0) return 0;
  return divRoundHalfAway(outG * 1000, inG);
}

export function closeGrams(openG: number, usedG: number): number {
  return openG - usedG;
}

export function producedGrams(runs: PressRunRow[]): number {
  return runs.reduce((sum, run) => sum + run.outG, 0);
}

export function accumulatedOutG(runs: PressRunRow[], throughId: string): number {
  let sum = 0;
  for (const run of runs) {
    sum += run.outG;
    if (run.id === throughId) break;
  }
  return sum;
}

export type SuggestHit = {
  copy: DieCopy;
  latest: number;
  band: Band;
};

/** Lightest in-band copy that is available or in use. Ignores colour. */
export function suggestFirst(section: Section, added: Band[] = []): SuggestHit | null {
  const hits: SuggestHit[] = [];
  for (const copy of section.copies) {
    if (copy.status !== "available" && copy.status !== "in_use") continue;
    const latest = latestMilli(copy);
    if (latest === null) continue;
    const band = effectiveBand(section, copy, added);
    if (bandPosition(latest, band) !== "in") continue;
    hits.push({ copy, latest, band });
  }
  hits.sort((a, b) => {
    if (a.latest !== b.latest) return a.latest - b.latest;
    if (a.copy.tierRank !== b.copy.tierRank) return a.copy.tierRank - b.copy.tierRank;
    return a.copy.code.localeCompare(b.copy.code);
  });
  return hits[0] ?? null;
}

export function normalizeDieQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\//g, "-").replace(/\s+/g, " ");
}

export function sectionMatches(section: Section, query: string): boolean {
  const n = normalizeDieQuery(query);
  if (!n) return true;
  const hay = [
    section.sectionCode,
    section.series,
    section.name,
    section.alloy,
    section.temper,
    section.ownerName ?? "",
    section.ownerCity ?? "",
    ...section.copies.map((copy) => copy.code),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(n);
}

export function copyQueryHit(query: string, codes: string[]): string | null {
  const n = normalizeDieQuery(query);
  if (!n) return null;
  return codes.find((code) => code.toLowerCase() === n) ?? codes.find((code) => code.toLowerCase().includes(n)) ?? null;
}

export function parseWallTenths(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = match[2] ?? "";
  let tenths = whole * 10;
  if (frac.length === 0) {
    // whole millimetres
  } else if (frac.length === 1) {
    tenths += Number(frac);
  } else {
    const milli = Number(frac.padEnd(3, "0").slice(0, 3));
    tenths += Math.floor(milli / 100);
    if (milli % 100 >= 50) tenths += 1;
  }
  return tenths > 0 ? tenths : null;
}

export function parseKgToMilli(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = match[2] ?? "";
  const milliFrac = Number((frac.padEnd(3, "0").slice(0, 3) || "0"));
  let milli = whole * 1000 + milliFrac;
  const extra = frac[3];
  if (extra && Number(extra) >= 5) milli += 1;
  return milli;
}

export function findDuplicateBand(bands: Band[], wallTenthMm: number, minG: number, maxG: number): Band | null {
  return (
    bands.find(
      (band) =>
        band.active && band.wallTenthMm === wallTenthMm && band.weightMinG === minG && band.weightMaxG === maxG,
    ) ?? null
  );
}

export function formatWallMm(tenths: number): string {
  const whole = Math.floor(Math.abs(tenths) / 10);
  const frac = Math.abs(tenths) % 10;
  return `${tenths < 0 ? "-" : ""}${whole}.${frac}`;
}

export function formatMilliKg(milli: number): string {
  const neg = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-IN")}.${frac}`;
}

export function formatKgWhole(grams: number): string {
  return divRoundHalfAway(grams, 1000).toLocaleString("en-IN");
}

export function formatKgPerM(milli: number): string {
  return formatFixedThousandths(kgPerMThousandths(milli));
}

export function formatPctTenth(tenth: number): string {
  const sign = tenth > 0 ? "+" : tenth < 0 ? "-" : "";
  const abs = Math.abs(tenth);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}%`;
}

export function formatRecovery(outG: number, inG: number): string {
  const tenths = recoveryTenths(outG, inG);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

export function formatSpeed(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function formatBandRange(band: Band): string {
  return `${formatMilliKg(band.weightMinG)}–${formatMilliKg(band.weightMaxG)}`;
}

export function formatGrams(grams: number): string {
  return `${grams.toLocaleString("en-IN")} g`;
}

export function duplicateBandMessage(section: Section, wallTenthMm: number, minG: number, maxG: number): string {
  return `${section.sectionCode} ${section.series} already has this band (${formatWallMm(wallTenthMm)} mm, ${formatMilliKg(minG)}–${formatMilliKg(maxG)} kg/12 ft)`;
}

export function lifeLine(producedG: number, lifeG: number): string {
  return `${formatKgWhole(producedG)} kg of ${formatKgWhole(lifeG)} kg`;
}

export function lifeReached(producedG: number, lifeG: number): boolean {
  return producedG >= lifeG;
}

export function statusLabel(status: CopyStatus): string {
  switch (status) {
    case "available":
      return "Available";
    case "in_use":
      return "In use";
    case "at_nitriding":
      return "At nitriding";
    case "at_maker":
      return "At maker";
    case "retired":
      return "Retired";
  }
}

export function profileLabel(kind: ProfileKind): string {
  switch (kind) {
    case "hollow":
      return "Hollow";
    case "solid":
      return "Solid";
    case "semi":
      return "Semi";
  }
}

export function purposeLabel(purpose: MakerPurpose): string {
  switch (purpose) {
    case "trial":
      return "Trial";
    case "correction":
      return "Correction";
    case "repair":
      return "Repair";
  }
}

export function bandPositionWord(position: BandPosition): string {
  switch (position) {
    case "in":
      return "In band";
    case "above":
      return "Above";
    case "below":
      return "Under";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024).toLocaleString("en-IN")} KB`;
}

function formatFixedThousandths(thousandths: number): string {
  const neg = thousandths < 0;
  const abs = Math.abs(thousandths);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-IN")}.${frac}`;
}
