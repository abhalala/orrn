import { createAuth } from "@orrn/auth";
import { atomicBatch, type createDb } from "@orrn/db";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem, transporter, type DispatchStatus } from "@orrn/db/schema/dispatch";
import {
  bundle,
  bundleGroup,
  bundleStatusEvent,
  packReject,
  type BundleStatus,
} from "@orrn/db/schema/inventory";
import { packingList, packingListDispatch, packingListLine } from "@orrn/db/schema/packing";
import { auditLog } from "@orrn/db/schema/audit";
import { approval } from "@orrn/db/schema/approval";
import { countLine, countLocation, countSeen, countSession, countTally } from "@orrn/db/schema/count";
import { cast, melt, meltChemical, meltInput, meltOutput, returnStream, spectroResult } from "@orrn/db/schema/foundry";
import {
  dcNote,
  purchaseLot,
  scrapGrade,
  scrapItem,
  vendor,
  vendorAlias,
  type BillBook,
  type PurchaseLotStatus,
  type VendorStatus,
} from "@orrn/db/schema/purchase";
import { bundleTransfer, salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import {
  dieBand,
  dieFile,
  dieInstance,
  dieMaker,
  dieMakerJob,
  dieTierChange,
  dieWeightReading,
  nitridingLog,
} from "@orrn/db/schema/dies";
import { dieIssue, pressLine, pressPlan, pressPlanDie, pressPlanLine, pressRun } from "@orrn/db/schema/press";
import { reasonCode } from "@orrn/db/schema/reasons";
import { COMPANY_MODULES, defaultReasonCodeRows, SUGGESTED_SHIFTS } from "@orrn/domain";
import { docSeries } from "@orrn/db/schema/series";
import { location, stockLedger } from "@orrn/db/schema/stock";
import { storeItem, storeTxn } from "@orrn/db/schema/store";
import { companySequence } from "@orrn/db/schema/sync";
import { company, membership, platformAdmin } from "@orrn/db/schema/tenant";
import { packingListWriteBatch } from "@orrn/server/routers/packingList";
import { formatBundleSerial, formatGroupCode } from "@orrn/server/lib/bundleSerial";
import { formatDispatchCode } from "@orrn/server/lib/dispatchCode";
import { DEFAULT_LOCATIONS, defaultLocationStatements, openingRows } from "@orrn/server/lib/ledger";
import { nextCompanySeq } from "@orrn/server/lib/sequence";
import { kgPer12ftMilli } from "@orrn/server/lib/bundleWeight";
import { docPeriod, nextDocNumber } from "@orrn/server/lib/docNumber";
import {
  bookDateInstant,
  DEFAULT_SCRAP_GRADES,
  DEFAULT_SCRAP_ITEMS,
  nameKey,
  scrapItemRef,
} from "@orrn/server/lib/purchase";
import { and, eq, getTableColumns, inArray, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { DEV_ACCOUNTS, type DevAccountKey } from "./dev-accounts";
import { demoOrderSeed } from "./dev-seed-orders";
import { seedPlatformRows } from "./dev-seed-platform";

type Db = ReturnType<typeof createDb>;
type Statement = BatchItem<"sqlite">;

/** D1 rejects statements with more than 100 bound parameters. */
const MAX_PARAMS = 100;
const COMPANY_ID = "dev-company-orrn";
const LENGTH_12FT_MM = 3658;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Demo plant numbers new bundles like the real plant (26I4086); seeded history keeps its BG serials.
 * FP Wave 1 masters live in settings too: Day / Night shifts (C14, written here as the plant would
 * by pressing Save on the suggestion) and the BIS pairs with the CM/L left blank for the plant.
 */
const DEMO_SETTINGS = {
  lengthUnit: "inch",
  timezone: "Asia/Kolkata",
  bundleNumbering: "plant",
  dcTolerancePct: 50,
  shifts: SUGGESTED_SHIFTS.map((s) => ({ ...s, id: `dev-shift-${s.seq}` })),
  standards: { solid: { standard: "IS 733", cml: "" }, hollow: { standard: "IS 1285", cml: "" } },
};

/** Every module on, Wave 1 floor modules included (FP-PF-07). */
const ALL_MODULES: string[] = [...COMPANY_MODULES];

// ---------------------------------------------------------------------------
// Static catalogue
// ---------------------------------------------------------------------------
type DieDef = {
  key: string;
  series: string;
  code: string;
  name: string;
  /** kg per 12 ft, per piece (stored as grams on the die). */
  minKg: number;
  maxKg: number;
  /** Section sizes in inches, mapped to the die's mm columns. */
  widthIn?: number;
  thicknessIn?: number;
  legIn?: number;
};

const DIES: DieDef[] = [
  { key: "patti1", series: "PATTI", code: "14701", name: `Patti 1" × 1/8"`, minKg: 2.4, maxKg: 2.6, widthIn: 1, thicknessIn: 0.125 },
  { key: "angle1", series: "ANGLE", code: "11250", name: `Angle 1" × 1"`, minKg: 2.0, maxKg: 2.2, legIn: 1, thicknessIn: 0.125 },
  { key: "tee125", series: "TEE", code: "13090", name: `Tee 1¼"`, minKg: 2.7, maxKg: 2.9, widthIn: 1.25 },
  { key: "chan075", series: "CHANNEL", code: "12212", name: `Channel ¾"`, minKg: 2.2, maxKg: 2.4, widthIn: 0.75 },
  { key: "patti15", series: "PATTI", code: "14715", name: `Patti 1½" × 3/16"`, minKg: 3.0, maxKg: 3.2, widthIn: 1.5, thicknessIn: 0.1875 },
  { key: "angle125", series: "ANGLE", code: "11262", name: `Angle 1¼" × 1¼"`, minKg: 2.5, maxKg: 2.7, legIn: 1.25, thicknessIn: 0.125 },
  { key: "flat2", series: "FLAT", code: "14730", name: `Flat 2" × 1/8"`, minKg: 2.9, maxKg: 3.1, widthIn: 2, thicknessIn: 0.125 },
  { key: "tee1", series: "TEE", code: "13072", name: `Tee 1"`, minKg: 2.1, maxKg: 2.3, widthIn: 1 },
  { key: "chan1", series: "CHANNEL", code: "12230", name: `Channel 1"`, minKg: 2.8, maxKg: 3.0, widthIn: 1 },
  { key: "angle15", series: "ANGLE", code: "11280", name: `Angle 1½" × 1½"`, minKg: 3.1, maxKg: 3.3, legIn: 1.5, thicknessIn: 0.1875 },
  { key: "tube075", series: "TUBE", code: "15204", name: `Round Tube ¾"`, minKg: 2.3, maxKg: 2.5, widthIn: 0.75 },
  { key: "sqtube1", series: "TUBE", code: "15310", name: `Square Tube 1" × 1"`, minKg: 2.6, maxKg: 2.8, widthIn: 1 },
];

type Address = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

type CustomerDef = {
  key: string;
  name: string;
  phone: string;
  email: string;
  taxId: string;
  notes: string;
  billing: Address;
  shipping: Address;
};

const IN = "India";
const CUSTOMERS: CustomerDef[] = [
  {
    key: "kd",
    name: "KD Extrusion",
    phone: "+91 98250 11234",
    email: "accounts@kdextrusion.example",
    taxId: "24AABCK4471M1Z6",
    notes: "Regular buyer of patti and angle. Pays within 30 days.",
    billing: { line1: "Plot 41, GIDC Industrial Estate", line2: "Vatva", city: "Ahmedabad", state: "Gujarat", postalCode: "382445", country: IN },
    shipping: { line1: "Plot 41, GIDC Industrial Estate", line2: "Vatva", city: "Ahmedabad", state: "Gujarat", postalCode: "382445", country: IN },
  },
  {
    key: "royal",
    name: "Royal Aluminium",
    phone: "+91 98240 55781",
    email: "orders@royalaluminium.example",
    taxId: "24AAGFR8812K1Z2",
    notes: "Takes tee and channel in mixed bundles.",
    billing: { line1: "12, Shreeji Complex", line2: "Kalawad Road", city: "Rajkot", state: "Gujarat", postalCode: "360005", country: IN },
    shipping: { line1: "Godown 7, Aji Industrial Area", line2: "Gondal Road", city: "Rajkot", state: "Gujarat", postalCode: "360002", country: IN },
  },
  {
    key: "tejura",
    name: "Tejura & Sons",
    phone: "+91 97270 40318",
    email: "tejura.sons@example.com",
    taxId: "24AAHFT2290D1Z9",
    notes: "Collects from the plant gate. Call before loading.",
    billing: { line1: "Ward 3, Station Road", line2: "Near Old Bus Stand", city: "Morbi", state: "Gujarat", postalCode: "363641", country: IN },
    shipping: { line1: "Ward 3, Station Road", line2: "Near Old Bus Stand", city: "Morbi", state: "Gujarat", postalCode: "363641", country: IN },
  },
  {
    key: "shivam",
    name: "Shivam Bhavnagar",
    phone: "+91 99099 27650",
    email: "shivam.bhavnagar@example.com",
    taxId: "24AAEPS6034Q1ZB",
    notes: "Window and door fabricator, weekly pickup.",
    billing: { line1: "B-18, Ghogha Circle Market", line2: "", city: "Bhavnagar", state: "Gujarat", postalCode: "364001", country: IN },
    shipping: { line1: "Shed 5, Sidsar Road", line2: "Industrial Zone", city: "Bhavnagar", state: "Gujarat", postalCode: "364002", country: IN },
  },
  {
    key: "apex",
    name: "Apex Fabricators",
    phone: "+91 98795 13092",
    email: "procurement@apexfab.example",
    taxId: "27AAICA5518J1ZP",
    notes: "Outstation buyer. Needs packing list PDF with every load.",
    billing: { line1: "Gala 14, Vasai Phata Industrial Complex", line2: "Vasai East", city: "Palghar", state: "Maharashtra", postalCode: "401208", country: IN },
    shipping: { line1: "Gala 14, Vasai Phata Industrial Complex", line2: "Vasai East", city: "Palghar", state: "Maharashtra", postalCode: "401208", country: IN },
  },
  {
    key: "mehta",
    name: "Mehta Windows",
    phone: "+91 94280 67715",
    email: "mehta.windows@example.com",
    taxId: "24AAFPM3307L1Z4",
    notes: "Small orders, usually flat and square tube.",
    billing: { line1: "7, Navrangpura Shopping Centre", line2: "CG Road", city: "Ahmedabad", state: "Gujarat", postalCode: "380009", country: IN },
    shipping: { line1: "7, Navrangpura Shopping Centre", line2: "CG Road", city: "Ahmedabad", state: "Gujarat", postalCode: "380009", country: IN },
  },
];

type SessionDef = {
  dieKey: string;
  count: number;
  /** Whole days before today (IST). 0 = today. */
  daysAgo: number;
  /** IST hour of day for past days; for today we use `todayFraction`. */
  hour: number;
  todayFraction?: number;
  note: string;
};

/** 8 packing sessions, 120 bundles, 2 of them today. */
const SESSIONS: SessionDef[] = [
  { dieKey: "patti1", count: 14, daysAgo: 9, hour: 10.5, note: "Press 1, day shift" },
  { dieKey: "angle1", count: 16, daysAgo: 8, hour: 14.25, note: "Press 2, day shift" },
  { dieKey: "tee125", count: 15, daysAgo: 6, hour: 9.75, note: "Press 1, day shift" },
  { dieKey: "chan075", count: 12, daysAgo: 5, hour: 15.5, note: "Press 2, day shift" },
  { dieKey: "patti15", count: 18, daysAgo: 3, hour: 11.0, note: "Press 1, day shift" },
  { dieKey: "angle125", count: 15, daysAgo: 2, hour: 16.0, note: "Press 2, evening shift" },
  { dieKey: "flat2", count: 16, daysAgo: 0, hour: 0, todayFraction: 0.3, note: "Press 1, morning run" },
  { dieKey: "angle1", count: 14, daysAgo: 0, hour: 0, todayFraction: 0.55, note: "Press 2, second run" },
];

// ---------------------------------------------------------------------------
// Scrap purchase (PL-6): vendors as the purchase book spells them, and ten lots
// ---------------------------------------------------------------------------
type VendorDef = { key: string; name: string; aliases: string[]; gstin: string | null; city: string; status: VendorStatus };

/** Demo vendors; aliases are the other spellings the book and the floor use. Brokers are not vendors. */
const VENDORS: VendorDef[] = [
  { key: "kd", name: "K.D. Metals", aliases: ["KD Metal", "K.D. Metal Works"], gstin: "24AAKFK1234L1Z5", city: "Rajkot", status: "active" },
  { key: "ganesh", name: "Shree Ganesh Metal Traders", aliases: ["Ganesh Metal", "SHREE GANESH"], gstin: "24ABQPG5678M1Z2", city: "Ahmedabad", status: "active" },
  { key: "ambe", name: "Jay Ambe Scrap Co.", aliases: ["Jay Ambe", "JAI AMBE SCRAP"], gstin: null, city: "Rajkot", status: "active" },
  { key: "rar", name: "Rajkot Alu Recyclers", aliases: ["RAR"], gstin: "24AAJCR4321K1ZQ", city: "Rajkot", status: "active" },
  { key: "mahavir", name: "Mahavir Metal Corporation", aliases: ["Mahavir Metals", "MAHAVEER METAL"], gstin: "27AAGFM7788P1Z9", city: "Mumbai", status: "active" },
  { key: "bharat", name: "Bharat Cable Scrap", aliases: ["Bharat Cable"], gstin: null, city: "Jamnagar", status: "active" },
  { key: "gulf", name: "Gulf Alloys Trading", aliases: ["Gulf Alloys"], gstin: "24AAHCG2468H1Z3", city: "Mundra", status: "active" },
  // Created inline at the kanta by the yard; waiting for a manager to confirm.
  { key: "patel", name: "Patel Kabadi Bhandar", aliases: ["Patel Kabadi"], gstin: null, city: "Gondal", status: "draft" },
];

type LotDef = {
  vendorKey: string;
  daysAgo: number;
  item: string;
  grade: string;
  origin: string;
  partyKg: number;
  fcKg: number | null;
  /** ₹ per kg. */
  rate: number;
  billBook: BillBook;
  status: PurchaseLotStatus;
  drossBp?: number;
  vehicleNo: string;
  /** Short-weighed lot: the debit note (kg diff + bori) the manager approved. */
  dcNote?: { kgDiff: number; boriKg: number; note: string };
};

const LOTS: LotDef[] = [
  { vendorKey: "kd", daysAgo: 18, item: "IMP BELLING", grade: "A", origin: "LOCAL", partyKg: 12_450, fcKg: 12_430, rate: 198.5, billBook: "main", status: "ok", drossBp: 350, vehicleNo: "GJ03AB4521" },
  { vendorKey: "ganesh", daysAgo: 16, item: "SOFT CABLE", grade: "A+", origin: "LOCAL", partyKg: 8_200, fcKg: 8_185, rate: 214, billBook: "main", status: "ok", vehicleNo: "GJ01CX7710" },
  {
    vendorKey: "ambe", daysAgo: 13, item: "KAGAL PATTI", grade: "B", origin: "LOCAL", partyKg: 6_540, fcKg: 6_320, rate: 176, billBook: "wb", status: "ok", drossBp: 600, vehicleNo: "GJ03BT2290",
    dcNote: { kgDiff: 220, boriKg: 45, note: "FC kanta 220 kg short; 30 bori × 1.5 kg" },
  },
  { vendorKey: "rar", daysAgo: 11, item: "CENTRING", grade: "A", origin: "EC GRADE", partyKg: 10_020, fcKg: 10_005, rate: 201, billBook: "ub", status: "ok", vehicleNo: "GJ03HK8801" },
  { vendorKey: "mahavir", daysAgo: 9, item: "ANGLE", grade: "A", origin: "MALAYSIA 6063", partyKg: 15_600, fcKg: 15_560, rate: 207, billBook: "main", status: "ok", drossBp: 280, vehicleNo: "MH04GR5521" },
  { vendorKey: "gulf", daysAgo: 7, item: "IMP BELLING", grade: "A+", origin: "DUBAI", partyKg: 18_000, fcKg: 17_950, rate: 211, billBook: "main", status: "ok", vehicleNo: "GJ12BZ3107" },
  { vendorKey: "bharat", daysAgo: 5, item: "SOFT CABLE", grade: "A", origin: "LOCAL", partyKg: 5_400, fcKg: 5_395, rate: 209, billBook: "wb", status: "ok", vehicleNo: "GJ10AC6612" },
  { vendorKey: "patel", daysAgo: 3, item: "TRANS PATRA", grade: "B", origin: "LOCAL", partyKg: 3_250, fcKg: 3_248, rate: 172, billBook: "ub", status: "ok", vehicleNo: "GJ03DL0954" },
  { vendorKey: "kd", daysAgo: 0, item: "TT", grade: "C", origin: "LOCAL", partyKg: 7_300, fcKg: 7_280, rate: 168, billBook: "main", status: "unload", vehicleNo: "GJ03AB4521" },
  { vendorKey: "ganesh", daysAgo: 0, item: "PATTA/ROTTER/HEATSINK", grade: "B", origin: "LOCAL", partyKg: 9_100, fcKg: null, rate: 182, billBook: "main", status: "booking", vehicleNo: "GJ01CX7710" },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
/** Deterministic PRNG so every seed run produces the same plant. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Epoch ms of 00:00 Asia/Kolkata, `daysAgo` days before the IST day containing `now`. */
function istMidnight(now: number, daysAgo: number) {
  const istDayStart = Math.floor((now + IST_OFFSET_MS) / DAY_MS) * DAY_MS;
  return istDayStart - daysAgo * DAY_MS - IST_OFFSET_MS;
}

function insertChunks<T extends SQLiteTable>(db: Db, table: T, rows: T["$inferInsert"][]): Statement[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(getTableColumns(table)).length;
  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / columns));
  const out: Statement[] = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    out.push(db.insert(table).values(rows.slice(i, i + perStatement)) as unknown as Statement);
  }
  return out;
}

function devLocationId(code: string) {
  return `dev-loc-${code}`;
}

function pick<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) throw new Error(`dev-seed: missing ${label} at ${index}`);
  return item;
}

async function ensureUser(db: Db, key: DevAccountKey, password: string) {
  const { email, name } = DEV_ACCOUNTS[key];
  const existing = await db.query.user.findFirst({ where: (fields, { eq: equals }) => equals(fields.email, email) });
  let id = existing?.id;
  if (!id) {
    const signUp = await createAuth().api.signUpEmail({ body: { name, email, password } });
    id = signUp?.user?.id;
    if (!id) throw new Error(`dev-seed: could not create ${email}`);
  }
  await db
    .update(user)
    .set({ emailVerified: true, onboardingCompleted: true, mustChangePassword: false })
    .where(eq(user.id, id));
  return { id, created: !existing };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
type SeedBundle = {
  id: string;
  sessionIdx: number;
  serial: string;
  dieKey: string;
  quantity: number;
  weightG: number;
  createdAt: number;
  status: BundleStatus;
  currentDispatchId: string | null;
  serverSeq: number;
  /** Chronological status history after receipt. */
  events: { from: BundleStatus; to: BundleStatus; reason: string; at: number; dispatchId: string | null }[];
};

export type SeedResult =
  | {
      ok: true;
      status: 200;
      message: string;
      companyId: string;
      accounts: Record<DevAccountKey, string>;
      createdUsers: DevAccountKey[];
      counts: Record<string, number>;
      bundlesByStatus: Record<string, number>;
    }
  | { ok: false; status: 500; message: string };

export async function seedDevData(db: Db, opts: { password: string }): Promise<SeedResult> {
  const now = Date.now();
  const password = opts.password;
  if (!password) throw new Error("dev-seed: refusing to run without ORRN_LOCAL_PASSWORD");

  // 1. Users go through Better Auth so password hashes are real.
  const users = {
    owner: await ensureUser(db, "owner", password),
    operator: await ensureUser(db, "operator", password),
    viewer: await ensureUser(db, "viewer", password),
    office: await ensureUser(db, "office", password),
    staff: await ensureUser(db, "staff", password),
  };
  const createdUsers = (Object.keys(users) as DevAccountKey[]).filter((key) => users[key].created);
  const ownerId = users.owner.id;
  const operatorId = users.operator.id;
  const officeId = users.office.id;

  // A user can belong to one company only; never silently move someone out of another tenant.
  const elsewhere = await db
    .select({ userId: membership.userId, companyId: membership.companyId })
    .from(membership)
    .where(
      and(
        inArray(membership.userId, [ownerId, operatorId, users.viewer.id, officeId]),
        ne(membership.companyId, COMPANY_ID),
      ),
    );
  if (elsewhere.length > 0) {
    throw new Error(
      `dev-seed: seed users already belong to another company (${elsewhere.map((m) => m.companyId).join(", ")}); reset the local D1 state`,
    );
  }

  // 2. Build the plant in memory.
  const rand = mulberry32(20261003);
  let seq = 0;
  const nextSeq = () => ++seq;

  const todayStart = istMidnight(now, 0);
  // "Today" work happens between 06:00 IST and now (or from midnight when seeding before 07:00).
  const todayWindowStart = now - todayStart > 7 * HOUR_MS ? todayStart + 6 * HOUR_MS : todayStart;
  const elapsedToday = Math.max(now - todayWindowStart, 1000);
  const todayAt = (fraction: number) => todayWindowStart + Math.floor(elapsedToday * fraction);
  const pastAt = (daysAgo: number, hour: number) => istMidnight(now, daysAgo) + Math.round(hour * HOUR_MS);

  const dieIds = new Map<string, string>();
  for (const def of DIES) dieIds.set(def.key, `dev-die-${def.code}`);
  const customerIds = new Map<string, string>();
  for (const def of CUSTOMERS) customerIds.set(def.key, `dev-customer-${def.key}`);
  const dieDef = (key: string) => {
    const def = DIES.find((d) => d.key === key);
    if (!def) throw new Error(`dev-seed: unknown die ${key}`);
    return def;
  };
  const dieId = (key: string) => {
    const id = dieIds.get(key);
    if (!id) throw new Error(`dev-seed: unknown die ${key}`);
    return id;
  };
  const customerId = (key: string) => {
    const id = customerIds.get(key);
    if (!id) throw new Error(`dev-seed: unknown customer ${key}`);
    return id;
  };

  // Packing sessions (bundle groups) first, so the first group is BG-000001.
  const groups: (typeof bundleGroup.$inferInsert)[] = [];
  const bundles: SeedBundle[] = [];
  const sessionBundles: SeedBundle[][] = [];
  SESSIONS.forEach((session, sessionIdx) => {
    const groupSeq = nextSeq();
    const groupCode = formatGroupCode(groupSeq);
    const groupId = `dev-group-${String(groupSeq).padStart(3, "0")}`;
    const def = dieDef(session.dieKey);

    const start =
      session.daysAgo === 0 ? todayAt(session.todayFraction ?? 0.3) : pastAt(session.daysAgo, session.hour);
    const maxSpan = session.daysAgo === 0 ? elapsedToday * 0.12 : Number.POSITIVE_INFINITY;
    const gap = Math.max(1000, Math.min(60_000 + rand() * 45_000, maxSpan / session.count));

    groups.push({
      id: groupId,
      companyId: COMPANY_ID,
      serverSeq: groupSeq,
      code: groupCode,
      dieId: dieId(session.dieKey),
      unit: "pcs",
      purchaseOrderRef: null,
      notes: session.note,
      createdBy: operatorId,
      createdAt: new Date(start),
      updatedAt: new Date(start),
    });

    const members: SeedBundle[] = [];
    for (let n = 1; n <= session.count; n += 1) {
      const perPieceG = Math.round(def.minKg * 1000 + rand() * (def.maxKg - def.minKg) * 1000);
      const targetKg = 44 + rand() * 14;
      const quantity = Math.min(24, Math.max(18, Math.round((targetKg * 1000) / perPieceG)));
      const createdAt = Math.floor(start + (n - 1) * gap);
      const row: SeedBundle = {
        id: `dev-bundle-${groupCode}-${String(n).padStart(3, "0")}`,
        sessionIdx,
        serial: formatBundleSerial(groupCode, n),
        dieKey: session.dieKey,
        quantity,
        weightG: quantity * perPieceG,
        createdAt,
        status: "available",
        currentDispatchId: null,
        serverSeq: groupSeq,
        events: [],
      };
      members.push(row);
      bundles.push(row);
    }
    sessionBundles.push(members);
  });

  const bundlesOf = (sessionIdx: number, from: number, to: number) => {
    const members = pick(sessionBundles, sessionIdx, "session");
    return members.slice(from, to);
  };

  // Customers and dies.
  const customerRows: (typeof customer.$inferInsert)[] = CUSTOMERS.map((def) => ({
    id: customerId(def.key),
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    name: def.name,
    phone: def.phone,
    email: def.email,
    taxId: def.taxId,
    notes: def.notes,
    billingAddress: def.billing,
    shippingAddress: def.shipping,
    createdAt: new Date(pastAt(10, 11)),
    updatedAt: new Date(pastAt(10, 11)),
  }));

  const mm = (inches: number | undefined) => (inches === undefined ? null : Math.round(inches * 25.4));
  const dieRows: (typeof die.$inferInsert)[] = DIES.map((def) => ({
    id: dieId(def.key),
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    series: def.series,
    sectionCode: def.code,
    name: def.name,
    legMm: mm(def.legIn),
    widthMm: mm(def.widthIn),
    thicknessMm: mm(def.thicknessIn),
    dimensions: { label: def.name, weightBasis: "kg per 12 ft" },
    weightMinG: Math.round(def.minKg * 1000),
    weightMaxG: Math.round(def.maxKg * 1000),
    status: "active" as const,
    createdAt: new Date(pastAt(10, 10)),
    updatedAt: new Date(pastAt(10, 10)),
  }));

  // Dispatches.
  type DispatchPlan = {
    id: string;
    code: string;
    seq: number;
    customerKey: string;
    status: DispatchStatus;
    createdAt: number;
    completedAt: number | null;
    shipDate: number | null;
    notes: string;
    members: SeedBundle[];
    labelled: boolean;
  };
  const dispatches: DispatchPlan[] = [];

  const draftSeq = nextSeq();
  dispatches.push({
    id: "dev-dispatch-draft",
    code: formatDispatchCode(draftSeq),
    seq: draftSeq,
    customerKey: "shivam",
    status: "draft",
    createdAt: pastAt(1, 16.75),
    completedAt: null,
    shipDate: now + 2 * DAY_MS,
    notes: "Being built from the angle 1¼\" run. Pickup planned in two days.",
    members: bundlesOf(5, 0, 6),
    labelled: false,
  });

  const heldSeq = nextSeq();
  const heldReserveSeq = nextSeq();
  const held: DispatchPlan = {
    id: "dev-dispatch-held",
    code: formatDispatchCode(heldSeq),
    seq: heldReserveSeq,
    customerKey: "tejura",
    status: "reserved",
    createdAt: pastAt(1, 17),
    completedAt: null,
    shipDate: now + DAY_MS,
    notes: "Held for tomorrow morning loading. Gate pass to be raised.",
    members: [...bundlesOf(4, 0, 5), ...bundlesOf(2, 8, 13)],
    labelled: true,
  };
  dispatches.push(held);

  const c1Seq = nextSeq();
  nextSeq(); // reserve step
  const c1CompleteSeq = nextSeq();
  const c1: DispatchPlan = {
    id: "dev-dispatch-done-1",
    code: formatDispatchCode(c1Seq),
    seq: c1CompleteSeq,
    customerKey: "kd",
    status: "completed",
    createdAt: pastAt(5, 11),
    completedAt: pastAt(4, 15),
    shipDate: pastAt(4, 15),
    notes: "Vehicle GJ-01 BT 4471. LR handed to driver.",
    members: [...bundlesOf(0, 0, 12), ...bundlesOf(1, 0, 8)],
    labelled: true,
  };
  dispatches.push(c1);

  const c2Seq = nextSeq();
  nextSeq(); // reserve step
  const c2CompleteSeq = nextSeq();
  const c2: DispatchPlan = {
    id: "dev-dispatch-done-2",
    code: formatDispatchCode(c2Seq),
    seq: c2CompleteSeq,
    customerKey: "royal",
    status: "completed",
    createdAt: todayAt(0.7),
    completedAt: todayAt(0.85),
    shipDate: todayAt(0.85),
    notes: "Vehicle GJ-03 AX 8120. Mixed tee and channel.",
    members: [...bundlesOf(2, 0, 8), ...bundlesOf(3, 0, 8)],
    labelled: true,
  };
  dispatches.push(c2);

  // Apply dispatch state to bundles, with one status event per transition.
  const reserveAt = (plan: DispatchPlan, offsetMin: number) => plan.createdAt + offsetMin * 60_000;
  for (const member of held.members) {
    member.status = "reserved";
    member.currentDispatchId = held.id;
    member.serverSeq = heldReserveSeq;
    member.events.push({ from: "available", to: "reserved", reason: "dispatch.reserve", at: reserveAt(held, 30), dispatchId: held.id });
  }
  for (const plan of [c1, c2]) {
    for (const member of plan.members) {
      member.status = "dispatched";
      member.currentDispatchId = plan.id;
      member.serverSeq = plan.seq;
      member.events.push(
        { from: "available", to: "reserved", reason: "dispatch.reserve", at: reserveAt(plan, 30), dispatchId: plan.id },
        { from: "reserved", to: "dispatched", reason: "dispatch.complete", at: plan.completedAt ?? now, dispatchId: plan.id },
      );
    }
  }

  // Three void bundles (damaged in handling, wrong die tag, bent).
  const voidPlan: [number, number, string][] = [
    [1, 15, "Damaged in handling"],
    [3, 11, "Bent bundle, sent for re-melt"],
    [4, 17, "Wrong die tag, re-packed"],
  ];
  for (const [sessionIdx, index, reason] of voidPlan) {
    const member = pick(pick(sessionBundles, sessionIdx, "session"), index, "bundle");
    member.status = "void";
    member.serverSeq = nextSeq();
    member.events.push({
      from: "available",
      to: "void",
      reason,
      at: Math.min(now - 60_000, member.createdAt + 2 * HOUR_MS),
      dispatchId: null,
    });
  }

  // 3. Write everything. Reset first so reseeding is idempotent.
  const dispatchRows: (typeof dispatch.$inferInsert)[] = dispatches.map((plan) => ({
    id: plan.id,
    companyId: COMPANY_ID,
    serverSeq: plan.seq,
    code: plan.code,
    customerId: customerId(plan.customerKey),
    status: plan.status,
    shipDate: plan.shipDate === null ? null : new Date(plan.shipDate),
    notes: plan.notes,
    createdBy: operatorId,
    completedBy: plan.completedAt === null ? null : ownerId,
    completedAt: plan.completedAt === null ? null : new Date(plan.completedAt),
    createdAt: new Date(plan.createdAt),
    updatedAt: new Date(plan.completedAt ?? plan.createdAt),
  }));

  const itemRows: (typeof dispatchItem.$inferInsert)[] = [];
  for (const plan of dispatches) {
    const labels = new Map<string, string>();
    plan.members.forEach((member, index) => {
      let groupLabel: string | null = null;
      if (plan.labelled) {
        if (!labels.has(member.dieKey)) labels.set(member.dieKey, String.fromCharCode(65 + labels.size));
        groupLabel = labels.get(member.dieKey) ?? null;
      }
      itemRows.push({
        id: `${plan.id}-item-${String(index + 1).padStart(3, "0")}`,
        companyId: COMPANY_ID,
        dispatchId: plan.id,
        bundleId: member.id,
        groupLabel,
        addedAt: new Date(plan.createdAt + (index + 1) * 20_000),
      });
    });
  }

  // Every bundle sits in one of the six yards (own generator, so the data above is unchanged).
  const yardIds = DEFAULT_LOCATIONS.filter((l) => l.kind === "yard").map((l) => devLocationId(l.code));
  const yardRand = mulberry32(13);
  const bundleRows: (typeof bundle.$inferInsert)[] = [];
  const eventRows: (typeof bundleStatusEvent.$inferInsert)[] = [];
  for (const member of bundles) {
    const lastAt = member.events.length > 0 ? Math.max(...member.events.map((event) => event.at)) : member.createdAt;
    const group = pick(groups, member.sessionIdx, "group");
    bundleRows.push({
      id: member.id,
      companyId: COMPANY_ID,
      serverSeq: member.serverSeq,
      groupId: group.id,
      dieId: dieId(member.dieKey),
      serial: member.serial,
      poNumber: null,
      quantity: member.quantity,
      weightG: member.weightG,
      lengthMm: LENGTH_12FT_MM,
      status: member.status,
      currentDispatchId: member.currentDispatchId,
      locationId: yardIds[Math.floor(yardRand() * yardIds.length)]!,
      kgPer12ftMilli: kgPer12ftMilli({ weightG: member.weightG, quantity: member.quantity, lengthMm: LENGTH_12FT_MM }),
      numberStyle: "legacy",
      createdBy: operatorId,
      createdAt: new Date(member.createdAt),
      updatedAt: new Date(lastAt),
    });
    eventRows.push({
      id: `${member.id}-evt-0`,
      companyId: COMPANY_ID,
      bundleId: member.id,
      fromStatus: null,
      toStatus: "available",
      reason: "receipt",
      actorId: operatorId,
      dispatchId: null,
      at: new Date(member.createdAt),
    });
    member.events.forEach((event, index) => {
      eventRows.push({
        id: `${member.id}-evt-${index + 1}`,
        companyId: COMPANY_ID,
        bundleId: member.id,
        fromStatus: event.from,
        toStatus: event.to,
        reason: event.reason,
        actorId: event.to === "dispatched" ? ownerId : operatorId,
        dispatchId: event.dispatchId,
        at: new Date(event.at),
      });
    });
  }

  // Demo sales orders (W1-OP-S, FP-OP): three orders in different states, one late; a few in-stock
  // bundles are packed for SO-1 line 1.
  const orderSeed = demoOrderSeed({
    companyId: COMPANY_ID,
    now,
    ownerId,
    officeId,
    customers: customerRows,
    dies: dieRows,
    bundles: bundleRows,
    nextSeq,
  });
  for (const row of bundleRows) {
    const lineId = row.id ? orderSeed.bundleLines.get(row.id) : undefined;
    if (lineId) row.salesOrderLineId = lineId;
  }

  // Scrap purchase: masters, vendors, lots, the approved D/C note and the OK lots' scrap postings.
  const grams = (kgValue: number) => Math.round(kgValue * 1000);
  const istDate = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
  const gradeId = (code: string) => `dev-grade-${code.replace("+", "plus")}`;
  const scrapItemId = (name: string) => `dev-scrap-${nameKey(name)}`;
  const vendorId = (key: string) => `dev-vendor-${key}`;
  const scrapLocationId = devLocationId("SCRAP");
  const gradeRows: (typeof scrapGrade.$inferInsert)[] = DEFAULT_SCRAP_GRADES.map((g, idx) => ({
    id: gradeId(g.code),
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    code: g.code,
    name: g.name,
    sortOrder: idx + 1,
    createdBy: ownerId,
  }));
  const scrapItemRows: (typeof scrapItem.$inferInsert)[] = DEFAULT_SCRAP_ITEMS.map((name, idx) => ({
    id: scrapItemId(name),
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    name,
    nameKey: nameKey(name),
    sortOrder: idx + 1,
    createdBy: ownerId,
  }));
  const vendorRows: (typeof vendor.$inferInsert)[] = VENDORS.map((v) => ({
    id: vendorId(v.key),
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    name: v.name,
    nameKey: nameKey(v.name),
    gstin: v.gstin,
    city: v.city,
    status: v.status,
    createdBy: v.status === "draft" ? operatorId : ownerId,
    createdAt: new Date(pastAt(20, 10)),
  }));
  const vendorAliasRows: (typeof vendorAlias.$inferInsert)[] = VENDORS.flatMap((v) =>
    v.aliases.map((aliasText, idx) => ({
      id: `${vendorId(v.key)}-alias-${idx + 1}`,
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      vendorId: vendorId(v.key),
      alias: aliasText,
      aliasKey: nameKey(aliasText),
      createdBy: ownerId,
    })),
  );
  const lotSeqByPeriod = new Map<string, number>();
  const lotRows: (typeof purchaseLot.$inferInsert)[] = [];
  const dcNoteRows: (typeof dcNote.$inferInsert)[] = [];
  const approvalRows: (typeof approval.$inferInsert)[] = [];
  const scrapLedgerRows: (typeof stockLedger.$inferInsert)[] = [];
  let dcSeq = 0;
  LOTS.forEach((def, idx) => {
    const id = `dev-lot-${String(idx + 1).padStart(2, "0")}`;
    const createdAt = def.daysAgo === 0 ? todayAt(0.2 + idx * 0.05) : pastAt(def.daysAgo, 9 + (idx % 4));
    const lotDate = istDate(createdAt);
    const period = docPeriod("lot", bookDateInstant(lotDate), DEMO_SETTINGS.timezone);
    const lotSeq = (lotSeqByPeriod.get(period) ?? 0) + 1;
    lotSeqByPeriod.set(period, lotSeq);
    const okAt = def.status === "ok" ? createdAt + 2 * HOUR_MS : null;
    const ratePaise = Math.round(def.rate * 100);
    lotRows.push({
      id,
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number: `LOT-${lotSeq}`,
      period,
      vendorId: vendorId(def.vendorKey),
      lotDate,
      origin: def.origin,
      scrapItemId: scrapItemId(def.item),
      scrapGradeId: gradeId(def.grade),
      partyKgG: grams(def.partyKg),
      fcKgG: def.fcKg === null ? null : grams(def.fcKg),
      ratePaise,
      drossBp: def.drossBp ?? null,
      billBook: def.billBook,
      vehicleNo: def.vehicleNo,
      status: def.status,
      locationId: def.status === "ok" ? scrapLocationId : null,
      okAt: okAt === null ? null : new Date(okAt),
      okBy: okAt === null ? null : operatorId,
      createdBy: operatorId,
      createdAt: new Date(createdAt),
      updatedAt: new Date(okAt ?? createdAt),
    });
    let boriG = 0;
    if (def.dcNote) {
      dcSeq += 1;
      const noteId = `${id}-dcn`;
      const approvalId = `${noteId}-approval`;
      const raisedAt = createdAt + HOUR_MS;
      const decidedAt = createdAt + 5 * HOUR_MS;
      const kgDiffG = grams(def.dcNote.kgDiff);
      boriG = grams(def.dcNote.boriKg);
      const amountPaise = Math.round(((kgDiffG + boriG) * ratePaise) / 1000);
      dcNoteRows.push({
        id: noteId,
        companyId: COMPANY_ID,
        serverSeq: nextSeq(),
        number: `DCN-${dcSeq}`,
        period: docPeriod("dc_note", new Date(raisedAt), DEMO_SETTINGS.timezone),
        lotId: id,
        type: "debit",
        reason: "weight",
        kgDiffG,
        boriDeductionG: boriG,
        amountPaise,
        toleranceBp: DEMO_SETTINGS.dcTolerancePct,
        note: def.dcNote.note,
        status: "approved",
        approvalId,
        decidedAt: new Date(decidedAt),
        // The office raised the note the yard started on the spot; the owner approved it.
        createdBy: officeId,
        createdAt: new Date(raisedAt),
        updatedAt: new Date(decidedAt),
      });
      approvalRows.push({
        id: approvalId,
        companyId: COMPANY_ID,
        serverSeq: nextSeq(),
        kind: "dc_note",
        subjectId: noteId,
        status: "approved",
        requestNote: def.dcNote.note,
        meta: { number: `DCN-${dcSeq}`, lotId: id, lotNumber: `LOT-${lotSeq}`, type: "debit", reason: "weight" },
        requestedBy: officeId,
        decidedBy: ownerId,
        decidedAt: new Date(decidedAt),
        createdAt: new Date(raisedAt),
        updatedAt: new Date(decidedAt),
      });
    }
    if (okAt !== null && def.fcKg !== null) {
      scrapLedgerRows.push({
        id: `${id}-ledger-1`,
        companyId: COMPANY_ID,
        serverSeq: nextSeq(),
        voucherType: "purchase_lot",
        voucherId: id,
        line: 1,
        itemKind: "scrap_grade",
        itemRef: scrapItemRef(scrapItemId(def.item), gradeId(def.grade)),
        locationId: scrapLocationId,
        qtyG: grams(def.fcKg) - boriG,
        postedAt: new Date(okAt),
        reason: `LOT-${lotSeq}`,
        createdBy: operatorId,
        createdAt: new Date(okAt),
      });
    }
  });
  // Series continue after the seeded book: the next lot / note from the app gets the next number.
  const purchaseSeriesRows: (typeof docSeries.$inferInsert)[] = [
    ...[...lotSeqByPeriod.entries()].map(([period, value]) => ({
      id: `dev-series-lot-${period}`,
      companyId: COMPANY_ID,
      docType: "lot" as const,
      period,
      value,
      createdBy: ownerId,
    })),
    ...[...new Set(dcNoteRows.map((n) => n.period))].map((period) => ({
      id: `dev-series-dc_note-${period}`,
      companyId: COMPANY_ID,
      docType: "dc_note" as const,
      period,
      value: dcNoteRows.filter((n) => n.period === period).length,
      createdBy: ownerId,
    })),
  ];

  // Die room demo (FP-DR): Tee 13090 has its primary band 2.700-2.900 and a heavier band
  // 2.900-3.100. 13090-1 is green, 13090-2 amber (above its band), 13090-3 on the heavy band red.
  // Channel 12230 belongs to KD Extrusion (owned section, one copy). Patti 14701-1 is issued to
  // Press 1 for run PR-1 (D13: an issue always targets a run that was queued on that section; the
  // run is now `die_issued`, so cancel puts it back in the queue). Readings are history; percent
  // and tone are computed.
  const devCopyId = (code: string) => `dev-copy-${code}`;
  const heavyBandId = "dev-band-13090-heavy";
  const dieBandRows: (typeof dieBand.$inferInsert)[] = [
    {
      id: heavyBandId,
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      sectionId: dieId("tee125"),
      wallTenthMm: 30,
      weightMinG: 2_900,
      weightMaxG: 3_100,
      label: "2.9-3.1",
      createdBy: ownerId,
      createdAt: new Date(pastAt(9, 10)),
      updatedAt: new Date(pastAt(9, 10)),
    },
  ];
  type CopyDef = { section: string; code: string; seqNo: number; tier: number | null; status: "available" | "in_use"; bandId?: string; readings: number[]; lifeG?: number };
  const COPIES: CopyDef[] = [
    { section: "tee125", code: "13090-1", seqNo: 1, tier: 1, status: "available", readings: [2_740, 2_760], lifeG: 60_000_000 },
    { section: "tee125", code: "13090-2", seqNo: 2, tier: 2, status: "available", readings: [2_910, 2_950] },
    { section: "tee125", code: "13090-3", seqNo: 3, tier: 1, status: "available", bandId: heavyBandId, readings: [3_150, 3_200] },
    { section: "chan1", code: "12230-1", seqNo: 1, tier: 1, status: "available", readings: [2_850] },
    { section: "patti1", code: "14701-1", seqNo: 1, tier: 1, status: "in_use", readings: [2_480] },
  ];
  const copyRows: (typeof dieInstance.$inferInsert)[] = COPIES.map((c) => ({
    id: devCopyId(c.code),
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    sectionId: dieId(c.section),
    seqNo: c.seqNo,
    code: c.code,
    status: c.status,
    tierRank: c.tier,
    tierSince: c.tier === null ? null : new Date(pastAt(9, 11)),
    lifeG: c.lifeG ?? null,
    bandId: c.bandId ?? null,
    createdBy: ownerId,
    createdAt: new Date(pastAt(9, 11)),
    updatedAt: new Date(pastAt(9, 11)),
  }));
  const copyTierRows: (typeof dieTierChange.$inferInsert)[] = COPIES.filter((c) => c.tier !== null).map((c) => ({
    id: `dev-tier-${c.code}`,
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    dieInstanceId: devCopyId(c.code),
    toRank: c.tier!,
    reason: "initial",
    status: "applied" as const,
    effectiveAt: new Date(pastAt(9, 11)),
    createdBy: ownerId,
  }));
  const readingRows: (typeof dieWeightReading.$inferInsert)[] = COPIES.flatMap((c) =>
    c.readings.map((milli, i) => ({
      id: `dev-reading-${c.code}-${i + 1}`,
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      dieInstanceId: devCopyId(c.code),
      kgPer12ftMilli: milli,
      lastKgPer12ftMilli: i === 0 ? null : c.readings[i - 1]!,
      readAt: new Date(pastAt(c.readings.length - i + 1, 9)),
      createdBy: ownerId,
    })),
  );
  const pressRunPeriod = docPeriod("press_run", new Date(now), DEMO_SETTINGS.timezone);
  const pressRunRows: (typeof pressRun.$inferInsert)[] = [
    {
      id: "dev-run-14701-1",
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number: "PR-1",
      period: pressRunPeriod,
      status: "die_issued",
      pressLineId: "dev-press-line-1",
      sectionId: dieId("patti1"),
      dieInstanceId: devCopyId("14701-1"),
      createdBy: ownerId,
      createdAt: new Date(todayAt(0.05)),
      updatedAt: new Date(todayAt(0.1)),
    },
  ];
  // The press run book continues after PR-1.
  const pressRunSeriesRows: (typeof docSeries.$inferInsert)[] = [
    { id: `dev-series-press_run-${pressRunPeriod}`, companyId: COMPANY_ID, docType: "press_run", period: pressRunPeriod, value: pressRunRows.length, createdBy: ownerId },
  ];
  const dieIssueRows: (typeof dieIssue.$inferInsert)[] = [
    {
      id: "dev-issue-14701-1",
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      dieInstanceId: devCopyId("14701-1"),
      pressLineId: "dev-press-line-1",
      pressRunId: "dev-run-14701-1",
      status: "issued",
      issuedAt: new Date(todayAt(0.1)),
      issuedBy: ownerId,
      note: "Day shift",
    },
  ];
  const ownedSectionId = dieId("chan1");
  const ownedBy = customerId(CUSTOMERS[0]!.key);

  // Sequence now covers everything allocated above; packing-list codes continue from it.
  const sequenceAfterData = seq;

  const statements: Statement[] = [
    // Reset: children before parents (several FKs are RESTRICT).
    db.delete(packingListLine).where(eq(packingListLine.companyId, COMPANY_ID)),
    db.delete(packingListDispatch).where(eq(packingListDispatch.companyId, COMPANY_ID)),
    db.delete(packingList).where(eq(packingList.companyId, COMPANY_ID)),
    // FP Wave 1 rows made in the app since the last seed: press runs and plans hold keys to order
    // lines, copies, casts and reason codes; transfers and pack rejects to bundles and groups.
    db.delete(dieIssue).where(eq(dieIssue.companyId, COMPANY_ID)),
    db.delete(pressRun).where(eq(pressRun.companyId, COMPANY_ID)),
    db.delete(pressPlanLine).where(eq(pressPlanLine.companyId, COMPANY_ID)),
    db.delete(pressPlanDie).where(eq(pressPlanDie.companyId, COMPANY_ID)),
    db.delete(pressPlan).where(eq(pressPlan.companyId, COMPANY_ID)),
    db.delete(pressLine).where(eq(pressLine.companyId, COMPANY_ID)),
    db.delete(reasonCode).where(eq(reasonCode.companyId, COMPANY_ID)),
    db.delete(bundleTransfer).where(eq(bundleTransfer.companyId, COMPANY_ID)),
    db.delete(packReject).where(eq(packReject.companyId, COMPANY_ID)),
    db.delete(dispatchItem).where(eq(dispatchItem.companyId, COMPANY_ID)),
    db.delete(bundleStatusEvent).where(eq(bundleStatusEvent.companyId, COMPANY_ID)),
    // Dev reset of the demo company only: the one place ledger rows are ever deleted (the
    // append-only grep test in plant-ledger.test.ts allows exactly this file).
    db.delete(stockLedger).where(eq(stockLedger.companyId, COMPANY_ID)),
    db.delete(approval).where(eq(approval.companyId, COMPANY_ID)),
    // Foundry and store rows hold RESTRICT FKs to lots, locations, store items and casts: delete
    // them child-to-parent before those (else the batch fails once the demo has one melt). Casts go
    // with doc_series, or the next casts.open reuses J1 and hits cast_company_period_seq_unique.
    db.delete(spectroResult).where(eq(spectroResult.companyId, COMPANY_ID)),
    db.delete(meltChemical).where(eq(meltChemical.companyId, COMPANY_ID)),
    db.delete(meltOutput).where(eq(meltOutput.companyId, COMPANY_ID)),
    db.delete(meltInput).where(eq(meltInput.companyId, COMPANY_ID)),
    db.delete(melt).where(eq(melt.companyId, COMPANY_ID)),
    db.delete(cast).where(eq(cast.companyId, COMPANY_ID)),
    db.delete(returnStream).where(eq(returnStream.companyId, COMPANY_ID)),
    // Store entries the app made since the last seed (RESTRICT on location and store_item; their
    // GRN/MRS numbers would also collide once doc_series restarts below). After the melts that draw on them.
    db.delete(storeTxn).where(eq(storeTxn.companyId, COMPANY_ID)),
    db.delete(storeItem).where(eq(storeItem.companyId, COMPANY_ID)),
    db.delete(dcNote).where(eq(dcNote.companyId, COMPANY_ID)),
    db.delete(purchaseLot).where(eq(purchaseLot.companyId, COMPANY_ID)),
    db.delete(vendorAlias).where(eq(vendorAlias.companyId, COMPANY_ID)),
    db.delete(vendor).where(eq(vendor.companyId, COMPANY_ID)),
    db.delete(scrapItem).where(eq(scrapItem.companyId, COMPANY_ID)),
    db.delete(scrapGrade).where(eq(scrapGrade.companyId, COMPANY_ID)),
    // Stock counts (PL-10): count_tally / count_location / count_seen / count_line hold RESTRICT keys to
    // location, and doc_series below restarts CNT-1 (the number is unique per company + period).
    db.delete(countTally).where(eq(countTally.companyId, COMPANY_ID)),
    db.delete(countLine).where(eq(countLine.companyId, COMPANY_ID)),
    db.delete(countSeen).where(eq(countSeen.companyId, COMPANY_ID)),
    db.delete(countLocation).where(eq(countLocation.companyId, COMPANY_ID)),
    db.delete(countSession).where(eq(countSession.companyId, COMPANY_ID)),
    db.delete(bundle).where(eq(bundle.companyId, COMPANY_ID)),
    db.delete(location).where(eq(location.companyId, COMPANY_ID)),
    db.delete(bundleGroup).where(eq(bundleGroup.companyId, COMPANY_ID)),
    db.delete(dispatch).where(eq(dispatch.companyId, COMPANY_ID)),
    db.delete(transporter).where(eq(transporter.companyId, COMPANY_ID)),
    // Order lines and orders reference die and customer (RESTRICT): they go first (PL-8 spec S-3).
    db.delete(salesOrderLine).where(eq(salesOrderLine.companyId, COMPANY_ID)),
    db.delete(salesOrder).where(eq(salesOrder.companyId, COMPANY_ID)),
    // Die room rows hold keys to the section (and copies to bands and makers): children first.
    db.delete(dieMakerJob).where(eq(dieMakerJob.companyId, COMPANY_ID)),
    db.delete(dieFile).where(eq(dieFile.companyId, COMPANY_ID)),
    db.delete(nitridingLog).where(eq(nitridingLog.companyId, COMPANY_ID)),
    db.delete(dieWeightReading).where(eq(dieWeightReading.companyId, COMPANY_ID)),
    db.delete(dieTierChange).where(eq(dieTierChange.companyId, COMPANY_ID)),
    db.delete(dieInstance).where(eq(dieInstance.companyId, COMPANY_ID)),
    db.delete(dieBand).where(eq(dieBand.companyId, COMPANY_ID)),
    db.delete(dieMaker).where(eq(dieMaker.companyId, COMPANY_ID)),
    db.delete(die).where(eq(die.companyId, COMPANY_ID)),
    db.delete(customer).where(eq(customer.companyId, COMPANY_ID)),
    db.delete(auditLog).where(eq(auditLog.companyId, COMPANY_ID)),
    db.delete(docSeries).where(eq(docSeries.companyId, COMPANY_ID)),
    db
      .insert(company)
      .values({
        id: COMPANY_ID,
        name: "Fourcubes Extrusions (Demo)",
        slug: "orrn-demo",
        status: "active",
        plan: "dev",
        settings: DEMO_SETTINGS,
        modules: ALL_MODULES,
        createdAt: new Date(pastAt(10, 9)),
      })
      .onConflictDoUpdate({
        target: company.id,
        set: {
          name: "Fourcubes Extrusions (Demo)",
          slug: "orrn-demo",
          status: "active",
          plan: "dev",
          settings: DEMO_SETTINGS,
          modules: ALL_MODULES,
        },
      }),
    db.delete(membership).where(eq(membership.companyId, COMPANY_ID)),
    db.insert(membership).values([
      { id: "dev-membership-owner", userId: ownerId, companyId: COMPANY_ID, role: "owner" as const },
      { id: "dev-membership-operator", userId: operatorId, companyId: COMPANY_ID, role: "operator" as const },
      { id: "dev-membership-viewer", userId: users.viewer.id, companyId: COMPANY_ID, role: "viewer" as const },
      { id: "dev-membership-office", userId: officeId, companyId: COMPANY_ID, role: "office" as const },
    ]),
    db
      .insert(platformAdmin)
      .values({ userId: users.staff.id, role: "super_admin" as const, createdBy: users.staff.id })
      .onConflictDoNothing(),
    db
      .insert(companySequence)
      .values({ companyId: COMPANY_ID, value: sequenceAfterData })
      .onConflictDoUpdate({ target: companySequence.companyId, set: { value: sequenceAfterData } }),
    ...insertChunks(db, customer, customerRows),
    ...insertChunks(db, die, dieRows),
    ...insertChunks(db, salesOrder, orderSeed.orders),
    ...insertChunks(db, salesOrderLine, orderSeed.lines),
    ...defaultLocationStatements(db, COMPANY_ID, { userId: ownerId, idFor: devLocationId }),
    ...insertChunks(db, bundleGroup, groups),
    ...insertChunks(db, bundle, bundleRows),
    ...insertChunks(db, bundleStatusEvent, eventRows),
    ...insertChunks(db, dispatch, dispatchRows),
    ...insertChunks(db, dispatchItem, itemRows),
    ...insertChunks(db, scrapGrade, gradeRows),
    ...insertChunks(db, scrapItem, scrapItemRows),
    ...insertChunks(db, vendor, vendorRows),
    ...insertChunks(db, vendorAlias, vendorAliasRows),
    ...insertChunks(db, purchaseLot, lotRows),
    ...insertChunks(db, dcNote, dcNoteRows),
    ...insertChunks(db, approval, approvalRows),
    ...insertChunks(db, stockLedger, scrapLedgerRows),
    ...insertChunks(db, docSeries, purchaseSeriesRows),
    ...insertChunks(db, docSeries, orderSeed.series),
    ...insertChunks(db, auditLog, orderSeed.audits),
    // FP Wave 1 masters: one press (tonnage left for the plant), the demo transporter, every
    // default reason code.
    ...insertChunks(db, pressLine, [
      { id: "dev-press-line-1", companyId: COMPANY_ID, code: "P1", name: "Press 1", sortOrder: 1, createdBy: ownerId },
    ]),
    ...insertChunks(db, transporter, [
      { id: "dev-transporter-1", companyId: COMPANY_ID, name: "Shree Logistics", createdBy: ownerId },
    ]),
    ...insertChunks(
      db,
      reasonCode,
      defaultReasonCodeRows().map((row) => ({
        ...row,
        id: `dev-reason-${row.kind}-${row.code}`,
        companyId: COMPANY_ID,
        createdBy: ownerId,
      })),
    ),
    // Die room demo (after the sections and the press line it points at).
    db.update(die).set({ ownerCustomerId: ownedBy }).where(and(eq(die.id, ownedSectionId), eq(die.companyId, COMPANY_ID))),
    ...insertChunks(db, dieBand, dieBandRows),
    ...insertChunks(db, dieInstance, copyRows),
    ...insertChunks(db, dieTierChange, copyTierRows),
    ...insertChunks(db, dieWeightReading, readingRows),
    ...insertChunks(db, pressRun, pressRunRows),
    ...insertChunks(db, docSeries, pressRunSeriesRows),
    ...insertChunks(db, dieIssue, dieIssueRows),
  ];
  await atomicBatch(db, statements);

  // 4. Packing lists for completed dispatches, built by the router's own writer so the
  //    snapshot shape matches production. Then backdate them to the completion time.
  const demoHeaders = [
    { vehicleNo: "GJ05AB1234", driverName: "Ramesh Patel", driverPhone: "9825011111", transporter: "Shree Logistics" },
    { vehicleNo: "GJ05CK7781", driverName: "Suresh Yadav", driverPhone: "9898022222", transporter: null },
  ];
  for (const [i, plan] of [c1, c2].entries()) {
    const found = await db.query.dispatch.findFirst({ where: eq(dispatch.id, plan.id) });
    if (!found) throw new Error(`dev-seed: dispatch ${plan.id} missing after insert`);
    // PL numbers come from the PL book series, as dispatch.complete assigns them (PL-8).
    const { number: plNumber } = await nextDocNumber(db, COMPANY_ID, "pl", new Date(plan.completedAt ?? now), ownerId);
    const header = demoHeaders[i] ?? demoHeaders[0]!;
    await db.update(dispatch).set({ plNumber, ...header }).where(eq(dispatch.id, plan.id));
    const dispatchRow = { ...found, plNumber, ...header };
    const { plId, statements: plStatements } = await packingListWriteBatch(db, {
      companyId: COMPANY_ID,
      dispatchRow,
      plNumber,
      session: { user: { id: ownerId } } as never,
    });
    await atomicBatch(db, plStatements);

    const plAt = new Date((plan.completedAt ?? now) + 60_000);
    const plRow = await db.query.packingList.findFirst({ where: eq(packingList.id, plId) });
    if (plRow) {
      await db
        .update(packingList)
        .set({ createdAt: plAt, snapshot: { ...plRow.snapshot, generatedAt: plAt.toISOString() } })
        .where(eq(packingList.id, plId));
    }
  }

  // 5. Opening balance: the seeded in-stock bundles are taken onto the kg ledger at their yard,
  //    exactly as stock.openingBalance does for a real plant's legacy stock.
  const openingSeq = await nextCompanySeq({ db }, COMPANY_ID);
  await atomicBatch(db, [
    openingRows(
      { db, companyId: COMPANY_ID, userId: ownerId, seq: openingSeq, postedAt: new Date(now) },
      { voucherId: "dev-opening-balance" },
    ),
  ]);

  // 6. FP-PF rows: a build per native platform, the pack tablet, one support request.
  await seedPlatformRows(db, { companyId: COMPANY_ID, ownerId, operatorId, staffId: users.staff.id, now });

  const bundlesByStatus: Record<string, number> = {};
  for (const member of bundles) bundlesByStatus[member.status] = (bundlesByStatus[member.status] ?? 0) + 1;

  const result: SeedResult = {
    ok: true,
    status: 200,
    message: "Seeded Fourcubes demo company (reset and re-created)",
    companyId: COMPANY_ID,
    accounts: {
      owner: DEV_ACCOUNTS.owner.email,
      operator: DEV_ACCOUNTS.operator.email,
      viewer: DEV_ACCOUNTS.viewer.email,
      office: DEV_ACCOUNTS.office.email,
      staff: DEV_ACCOUNTS.staff.email,
    },
    createdUsers,
    counts: {
      customers: customerRows.length,
      dies: dieRows.length,
      dieCopies: copyRows.length,
      dieBands: dieBandRows.length,
      dieReadings: readingRows.length,
      dieIssues: dieIssueRows.length,
      packingSessions: groups.length,
      bundles: bundleRows.length,
      dispatches: dispatchRows.length,
      packingLists: 2,
      locations: DEFAULT_LOCATIONS.length,
      vendors: vendorRows.length,
      vendorAliases: vendorAliasRows.length,
      scrapItems: scrapItemRows.length,
      scrapGrades: gradeRows.length,
      purchaseLots: lotRows.length,
      dcNotes: dcNoteRows.length,
    },
    bundlesByStatus,
  };
  return result;
}
