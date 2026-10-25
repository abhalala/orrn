import { createAuth } from "@orrn/auth";
import { atomicBatch } from "@orrn/db";
import { authThrottle, user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem, transporter, type DispatchStatus } from "@orrn/db/schema/dispatch";
import {
  bundle,
  bundleGroup,
  bundleStatusEvent,
  packReject,
} from "@orrn/db/schema/inventory";
import { packingList, packingListDispatch, packingListLine } from "@orrn/db/schema/packing";
import { auditLog } from "@orrn/db/schema/audit";
import { ageingBatch, ageingHardness, ageingOven, ageingRecipe, ageingRow, ageingTempLog, trolley } from "@orrn/db/schema/ageing";
import { approval } from "@orrn/db/schema/approval";
import { pressAlert, pressAlertThreshold, pressCollectorFrame, pressRunCollector, spectroInbox } from "@orrn/db/schema/collector";
import { countLine, countLocation, countSeen, countSession, countTally } from "@orrn/db/schema/count";
import {
  alloy,
  alloyLimit,
  cast,
  furnace,
  melt,
  meltChemical,
  meltInput,
  meltOutput,
  returnStream,
  spectroResult,
} from "@orrn/db/schema/foundry";
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
  dieWork,
  dieWeightReading,
  nitridingLog,
} from "@orrn/db/schema/dies";
import {
  dieIssue,
  dieRemark,
  pressBilletUse,
  pressDowntime,
  pressLine,
  pressPlan,
  pressPlanDie,
  pressPlanLine,
  pressRemark,
  pressRun,
  pressRunLine,
  qcEntry,
} from "@orrn/db/schema/press";
import { reasonCode } from "@orrn/db/schema/reasons";
import { labelTemplate, printLog, printerProfile } from "@orrn/db/schema/printing";
import { edgeNodeDeployment } from "@orrn/db/schema/spool";
import { AGEING_OVEN_SEED, AGEING_RECIPE_SUGGESTIONS, ALLOY_LIMIT_SEEDS, COMPANY_MODULES, defaultReasonCodeRows, formatCastCode, FURNACE_SEED, SUGGESTED_SHIFTS } from "@orrn/domain";
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
import { defaultReturnStreamStatements } from "@orrn/server/lib/foundry";
import { shiftAt } from "@orrn/server/lib/press";
import { kgPer12ftMilli } from "@orrn/server/lib/bundleWeight";
import { allocatePartyBundleNumbers, docPeriod, nextDocNumber } from "@orrn/server/lib/docNumber";
import {
  bookDateInstant,
  DEFAULT_SCRAP_GRADES,
  DEFAULT_SCRAP_ITEMS,
  nameKey,
  scrapItemRef,
} from "@orrn/server/lib/purchase";
import { and, eq, inArray, ne } from "drizzle-orm";

import {
  COMPANY_ID,
  DAY_MS,
  HOUR_MS,
  IST_OFFSET_MS,
  LENGTH_12FT_MM,
  devLocationId,
  insertChunks,
  istDay,
  mulberry32,
  pick,
  seedClock,
  type Db,
  type SeedBundle,
  type Statement,
} from "./dev-seed-kit";
import { buildAgeingDemo } from "./dev-seed-ageing";
import { DEV_ACCOUNTS, DEV_MEMBER_ROLES, type DevAccountKey, type DevMemberKey } from "./dev-accounts";
import { demoOrderSeed } from "./dev-seed-orders";
import { seedPlatformRows } from "./dev-seed-platform";
import { ensurePartyUser, seedPortalRows } from "./dev-seed-portal";
import { buildCount } from "./dev-seed-count";
import { SESSION_COPY, buildDieExtras, sectionExtras } from "./dev-seed-dies";
import { buildPressExtras, pressCloseLedger } from "./dev-seed-press";
import { buildPrinting } from "./dev-seed-printing";
import { buildStore } from "./dev-seed-store";
import { customerPortalSection, customerPortalUser, testCertificate } from "@orrn/db/schema/portal";

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
  // Wave 3: KD Extrusion's party login is seeded (dev-seed-portal.ts).
  portalEnabled: true,
  // The collector seed has a locked melt (dev-melt-1); left automatic, that would make every pack
  // session ask for a cast. The demo plant packs without one, as it did before that melt existed.
  requireCastOnBundle: false,
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
/** Customers with their own bundle number series (FP-PK-07); the rest use the plant serial. */
const PARTY_POLICIES: Record<string, "monthly" | "fy" | "lifelong"> = { kd: "monthly", royal: "fy" };

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

/** 9 packing sessions: eight runs (the last two today) and KD's own channel 12230 packed two days ago. */
const SESSIONS: SessionDef[] = [
  { dieKey: "patti1", count: 14, daysAgo: 9, hour: 10.5, note: "Press 1, day shift" },
  { dieKey: "angle1", count: 16, daysAgo: 8, hour: 14.25, note: "Press 2, day shift" },
  { dieKey: "tee125", count: 15, daysAgo: 6, hour: 9.75, note: "Press 1, day shift" },
  { dieKey: "chan075", count: 12, daysAgo: 5, hour: 15.5, note: "Press 2, day shift" },
  { dieKey: "patti15", count: 18, daysAgo: 3, hour: 11.0, note: "Press 1, day shift" },
  { dieKey: "angle125", count: 15, daysAgo: 2, hour: 16.0, note: "Press 2, evening shift" },
  { dieKey: "flat2", count: 16, daysAgo: 0, hour: 0, todayFraction: 0.3, note: "Press 1, morning run" },
  { dieKey: "angle1", count: 14, daysAgo: 0, hour: 0, todayFraction: 0.55, note: "Press 2, second run" },
  // KD's own die 12230 (BG-000009): packed two days ago for SO-10 (a calendar day back would fall inside today's production day when seeded before 08:00), the one order that may take it.
  { dieKey: "chan1", count: 8, daysAgo: 2, hour: 15.25, note: "Press 1, day shift: KD's 12230" },
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

/**
 * `now` is for tests only: the seed builds every time from it (the production day, days back), so a test can seed
 * at any hour, across a month or a financial year. The route never passes it.
 */
export async function seedDevData(db: Db, opts: { password: string; now?: number }): Promise<SeedResult> {
  const now = opts.now ?? Date.now();
  const password = opts.password;
  if (!password) throw new Error("dev-seed: refusing to run without ORRN_LOCAL_PASSWORD");

  // 1. Users go through Better Auth so password hashes are real. Every plant role has a login
  //    (DEV_MEMBER_ROLES), plus the platform staff account; the party login is made below by the
  //    portal seed, outside Better Auth, and is never a member.
  const memberKeys = Object.keys(DEV_MEMBER_ROLES) as DevMemberKey[];
  const users = {} as Record<DevMemberKey | "staff", { id: string; created: boolean }>;
  for (const key of [...memberKeys, "staff" as const]) users[key] = await ensureUser(db, key, password);
  const createdUsers = (Object.keys(users) as (keyof typeof users)[]).filter((key) => users[key].created) as DevAccountKey[];
  const ownerId = users.owner.id;
  const operatorId = users.operator.id;
  const officeId = users.office.id;
  // KD's portal login placed SO-4; it must exist before the order book is built.
  const partyUserId = await ensurePartyUser(db, DEV_ACCOUNTS.party, password);

  // A user can belong to one company only; never silently move someone out of another tenant.
  const elsewhere = await db
    .select({ userId: membership.userId, companyId: membership.companyId })
    .from(membership)
    .where(
      and(
        inArray(
          membership.userId,
          memberKeys.map((key) => users[key].id),
        ),
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

  // One clock for the whole seed: calendar days back (`pastAt`) and the CURRENT PRODUCTION DAY
  // (`todayAt`, 08:00 to 08:00 for the demo shifts), so "today" data is always inside the window the
  // dashboard, pack and the press report read, whatever the hour the seed runs at (7f172a70).
  const clock = seedClock(now, DEMO_SETTINGS);
  const todayAt = clock.dayAt;
  const pastAt = clock.pastAt;
  const todayWindowStart = clock.day.startMs;
  const elapsedToday = Math.max(now - todayWindowStart, 1000);

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
      dieInstanceId: `dev-copy-${SESSION_COPY[sessionIdx]}`,
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
    // FP-PK-07: two customers keep their own bundle numbers (monthly 26J12 / fy 2026-27/12).
    bundleNumberPolicy: PARTY_POLICIES[def.key] ?? null,
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
    ...sectionExtras(def.code),
    createdAt: new Date(pastAt(10, 10)),
    updatedAt: new Date(pastAt(10, 10)),
  }));

  // Dispatches.
  type DispatchHeader = {
    vehicleNo: string;
    driverName: string;
    driverPhone: string;
    transporter: string | null;
    transporterId?: string;
    transporterName?: string;
    vehicleCapacityG?: number;
    invoiceNumber?: string;
    invoiceDate?: string;
  };
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
    /** Vehicle, driver, transporter and the Tally invoice the office linked (the gate and the office fill these). */
    header?: DispatchHeader;
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
    header: { vehicleNo: "GJ03BV5530", driverName: "Dinesh Solanki", driverPhone: "9825033333", transporter: null },
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
    // FP-PK-12: the first truck went with the transporter master and a 9 t capacity; the office linked Tally invoice 271 (SO-7).
    header: {
      vehicleNo: "GJ05AB1234",
      driverName: "Ramesh Patel",
      driverPhone: "9825011111",
      transporter: "Shree Logistics",
      transporterId: "dev-transporter-1",
      transporterName: "Shree Logistics",
      vehicleCapacityG: 9_000_000,
      invoiceNumber: "271/26-27",
      invoiceDate: istDay(now, 4),
    },
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
    // Opened from SO-8 (its baki on the scan screen); a 12 t truck, invoice not linked yet.
    header: {
      vehicleNo: "GJ05CK7781",
      driverName: "Suresh Yadav",
      driverPhone: "9898022222",
      transporter: "Balaji Roadways",
      transporterId: "dev-transporter-2",
      transporterName: "Balaji Roadways",
      vehicleCapacityG: 12_000_000,
    },
  };
  dispatches.push(c2);

  // Two Tejura trucks for SO-5 (patti 1½"), the same afternoon: their packing lists are combined into one.
  const truck = (n: 3 | 4, members: SeedBundle[], completedHour: number, vehicleNo: string, driverName: string, driverPhone: string, invoiceNumber: string): DispatchPlan => {
    const seqA = nextSeq();
    nextSeq(); // reserve step
    const seqDone = nextSeq();
    return {
      id: `dev-dispatch-done-${n}`,
      code: formatDispatchCode(seqA),
      seq: seqDone,
      customerKey: "tejura",
      status: "completed",
      createdAt: pastAt(2, completedHour - 2),
      completedAt: pastAt(2, completedHour),
      shipDate: pastAt(2, completedHour),
      notes: `Truck ${n - 2} of 2 for SO-5. Collected from the gate.`,
      members,
      labelled: true,
      header: { vehicleNo, driverName, driverPhone, transporter: null, invoiceNumber, invoiceDate: istDay(now, 2) },
    };
  };
  const c3 = truck(3, bundlesOf(4, 5, 8), 12.5, "GJ03BV5520", "Karsan Bhai", "9879044444", "268/26-27");
  const c4 = truck(4, bundlesOf(4, 8, 11), 15.25, "GJ03BV5521", "Mahesh Parmar", "9879055555", "269/26-27");
  dispatches.push(c3, c4);

  // Apply dispatch state to bundles, with one status event per transition.
  const reserveAt = (plan: DispatchPlan, offsetMin: number) => plan.createdAt + offsetMin * 60_000;
  for (const member of held.members) {
    member.status = "reserved";
    member.currentDispatchId = held.id;
    member.serverSeq = heldReserveSeq;
    member.events.push({ from: "available", to: "reserved", reason: "dispatch.reserve", at: reserveAt(held, 30), dispatchId: held.id });
  }
  for (const plan of [c1, c2, c3, c4]) {
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

  // Demo order book (FP-OP, BACKLOG 38): seven orders in every state, built from the bundles above.
  const copyIdOf = (code: string) => `dev-copy-${code}`;
  const orderSeed = demoOrderSeed({
    companyId: COMPANY_ID,
    now,
    clock,
    ownerId,
    officeId,
    managerId: users.manager.id,
    partyUserId,
    nextSeq,
    customerId,
    die: (key) => ({ id: dieId(key), weightMinG: Math.round(dieDef(key).minKg * 1000) }),
    copyId: copyIdOf,
    sessionBundles,
    dispatches: dispatches.map((plan) => ({
      id: plan.id,
      customerKey: plan.customerKey,
      status: plan.status,
      completedAt: plan.completedAt,
      members: plan.members,
    })),
  });

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
    vehicleNo: plan.header?.vehicleNo ?? null,
    driverName: plan.header?.driverName ?? null,
    driverPhone: plan.header?.driverPhone ?? null,
    transporter: plan.header?.transporter ?? null,
    transporterId: plan.header?.transporterId ?? null,
    transporterName: plan.header?.transporterName ?? null,
    vehicleCapacityG: plan.header?.vehicleCapacityG ?? null,
    invoiceNumber: plan.header?.invoiceNumber ?? null,
    invoiceDate: plan.header?.invoiceDate ?? null,
    salesOrderId: orderSeed.dispatchOrders.get(plan.id) ?? null,
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
        salesOrderLineId: orderSeed.itemLines.get(`${plan.id}|${member.id}`) ?? null,
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
      // The copy the run was pressed on, and the cast: sessions 5-7 from dev-press-cast-1 (billets still on hand), 2-4 from cast 2;
      // the two oldest sessions (KD's first truck) predate cast numbers on the bundle: the certificate says so.
      dieInstanceId: copyIdOf(SESSION_COPY[member.sessionIdx]!),
      castId: member.sessionIdx >= 5 ? "dev-press-cast-1" : member.sessionIdx >= 2 ? "dev-press-cast-2" : null,
      ...orderSeed.bundlePatches.get(member.id),
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

  // CNT-1 (PL-10): yards Y1 and Y2 counted two days ago, closed with a variance; and the printing set-up
  // with two labels waiting for the newest bundles.
  const locationOfBundle = new Map(bundleRows.map((r) => [r.id!, r.locationId ?? null]));
  const dieOfBundle = new Map(bundleRows.map((r) => [r.id!, r.dieId]));
  const countSeed = buildCount({
    companyId: COMPANY_ID,
    clock,
    countedBy: users.packer.id,
    closedBy: users.supervisor.id,
    nextSeq,
    bundles,
    yardOf: (id) => locationOfBundle.get(id) ?? null,
    dieOf: (id) => dieOfBundle.get(id)!,
    excluded: new Set([...orderSeed.ids.pendingBundleIds, ...orderSeed.ids.heldBundleIds]),
  });
  const newest = pick(sessionBundles, 7, "session"); // the second packing run of today
  const printing = buildPrinting({
    companyId: COMPANY_ID,
    clock,
    requestedBy: users.packer.id,
    nextSeq,
    waiting: newest.slice(-2),
  });

  // The store (PL-W6): five items with a GRN each and three issues.
  const storeSeed = buildStore({ companyId: COMPANY_ID, clock, storekeeperId: users.storekeeper.id, nextSeq });

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
  type CopyDef = { section: string; code: string; seqNo: number; tier: number | null; status: "available" | "in_use" | "on_trial"; bandId?: string; readings: number[]; lifeG?: number };
  const COPIES: CopyDef[] = [
    { section: "tee125", code: "13090-1", seqNo: 1, tier: 1, status: "available", readings: [2_740, 2_760], lifeG: 60_000_000 },
    { section: "tee125", code: "13090-2", seqNo: 2, tier: 2, status: "available", readings: [2_910, 2_950] },
    { section: "tee125", code: "13090-3", seqNo: 3, tier: 1, status: "available", bandId: heavyBandId, readings: [3_150, 3_200] },
    // One copy per width for the e2e mutations (readings 4-6, issue to a run 7-9, the 375 lift page 10),
    // so parallel workers never touch the same copy.
    { section: "tee125", code: "13090-4", seqNo: 4, tier: 1, status: "available", readings: [2_760] },
    { section: "tee125", code: "13090-5", seqNo: 5, tier: 1, status: "available", readings: [2_760] },
    { section: "tee125", code: "13090-6", seqNo: 6, tier: 1, status: "available", readings: [2_760] },
    { section: "tee125", code: "13090-7", seqNo: 7, tier: 1, status: "available", readings: [2_760] },
    { section: "tee125", code: "13090-8", seqNo: 8, tier: 1, status: "available", readings: [2_760] },
    { section: "tee125", code: "13090-9", seqNo: 9, tier: 1, status: "available", readings: [2_760] },
    { section: "tee125", code: "13090-10", seqNo: 10, tier: 2, status: "available", readings: [2_910, 2_950] },
    // FP-DR-17 (W2-DR2 e2e): three copies on trial per width. A: issued to the width's own trial run and taken
    // back; B: released by the owner with a reason; C: maker numbers, bulk file. Parallel workers never share one.
    ...Array.from({ length: 9 }, (_, i): CopyDef => ({ section: "tee125", code: `13090-${11 + i}`, seqNo: 11 + i, tier: 1, status: "on_trial", readings: [] })),
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
  // The rest of the die room: the other sections' copies, bands, nitriding, makers and the
  // proposals waiting for a manager (dev-seed-dies.ts).
  const dieExtras = buildDieExtras({
    companyId: COMPANY_ID,
    clock,
    ownerId,
    dieroomId: users.dieroom.id,
    nextSeq,
    section: (key) => ({ id: dieId(key), weightMinG: Math.round(dieDef(key).minKg * 1000), weightMaxG: Math.round(dieDef(key).maxKg * 1000) }),
    copyId: devCopyId,
    customerId,
  });
  dieBandRows.push(...dieExtras.bands);
  copyRows.push(...dieExtras.copies);
  copyTierRows.push(...dieExtras.tierChanges);
  readingRows.push(...dieExtras.readings);
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
    // Released and waiting for a die: Tee 13090 on Press 1 (PR-2, PR-3, PR-4). The die room issues a copy to each.
    {
      id: "dev-run-13090-queued",
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number: "PR-2",
      period: pressRunPeriod,
      status: "queued",
      pressLineId: "dev-press-line-1",
      sectionId: dieId("tee125"),
      createdBy: ownerId,
      createdAt: new Date(todayAt(0.06)),
      updatedAt: new Date(todayAt(0.06)),
    },
    // Two more for Tee: with PR-2, one queued run per width of the e2e (each issues its own copy to its own run).
    ...(["PR-3", "PR-4"] as const).map((number) => ({
      id: `dev-run-13090-queued-${number}`,
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number,
      period: pressRunPeriod,
      status: "queued" as const,
      pressLineId: "dev-press-line-1",
      sectionId: dieId("tee125"),
      createdBy: ownerId,
      createdAt: new Date(todayAt(0.06)),
      updatedAt: new Date(todayAt(0.06)),
    })),
    // Die trial runs for Tee (plan PP-2, purpose die_trial): the only runs a copy on trial may be issued to.
    // One per width of the die room e2e (PR-5, PR-6, PR-7).
    ...(["PR-5", "PR-6", "PR-7"] as const).map((number) => ({
      id: `dev-run-13090-trial-${number}`,
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number,
      period: pressRunPeriod,
      status: "queued" as const,
      planId: "dev-plan-trial-2",
      pressLineId: "dev-press-line-1",
      sectionId: dieId("tee125"),
      createdBy: ownerId,
      createdAt: new Date(todayAt(0.07)),
      updatedAt: new Date(todayAt(0.07)),
    })),
  ];
  // The press run book continues after PR-7.
  const pressRunSeriesRows: (typeof docSeries.$inferInsert)[] = [
    // value is read when the batch is built (after the Wave 2 press runs below are pushed).
    { id: `dev-series-press_run-${pressRunPeriod}`, companyId: COMPANY_ID, docType: "press_run", period: pressRunPeriod, value: 1, createdBy: ownerId },
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
  // FP Wave 2 press (W2-PR-S): one cast with billets on hand (paper-era opening), a run logged
  // today on P1 (the spec's worked example: 310.4 kg in, 234.2 kg good → 75.5 %, balance 31.4 kg)
  // with its lines, billets, QC and a closed downtime row, and a late entry on P2 waiting for its
  // press_late_entry approval (requested by the operator, so the owner can decide it).
  const castPeriod = docPeriod("cast", new Date(now), DEMO_SETTINGS.timezone);
  const castMonth = Number(castPeriod.slice(5));
  const castRows: (typeof cast.$inferInsert)[] = [
    {
      id: "dev-press-cast-1",
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number: formatCastCode(castMonth, 1),
      period: castPeriod,
      year: Number(castPeriod.slice(0, 4)),
      month: castMonth,
      seq: 1,
      alloy: "6063",
      alloyId: "dev-alloy-6063",
      status: "closed",
      notes: "Billets from the paper sheet (opening balance)",
      openedAt: new Date(pastAt(2, 8)),
      closedAt: new Date(pastAt(1, 18)),
      closedBy: ownerId,
      createdBy: ownerId,
    },
    // The cast the older packing sessions came from (no billets left on hand, no melt rows: the foundry
    // lane is paused). It gives KD's and Royal's older bundles a cast number for labels and certificates.
    {
      id: "dev-press-cast-2",
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number: formatCastCode(castMonth, 2),
      period: castPeriod,
      year: Number(castPeriod.slice(0, 4)),
      month: castMonth,
      seq: 2,
      alloy: "6063",
      alloyId: "dev-alloy-6063",
      status: "closed",
      notes: "Billets all pressed (paper sheet)",
      openedAt: new Date(pastAt(11, 8)),
      closedAt: new Date(pastAt(3, 18)),
      closedBy: ownerId,
      createdBy: ownerId,
    },
  ];
  const castSeriesRows: (typeof docSeries.$inferInsert)[] = [
    { id: `dev-press-series-cast-${castPeriod}`, companyId: COMPANY_ID, docType: "cast", period: castPeriod, value: castRows.length, createdBy: ownerId },
  ];
  const billetOpeningG = 2_400_000;
  // PR-8 counts on Today's "pressed today", which reads the CURRENT production day: its run and
  // downtime sit inside it (7f172a70).
  const pressDayAt = clock.dayAt;
  const loggedStart = pressDayAt(0.15);
  const loggedStop = pressDayAt(0.45);
  const loggedAt = pressDayAt(0.5);
  const loggedShift = shiftAt(DEMO_SETTINGS, loggedStart);
  const lateStart = pastAt(1, 22);
  const lateStop = pastAt(1, 23.5);
  const lateShift = shiftAt(DEMO_SETTINGS, lateStart);
  const loggedSeq = nextSeq();
  pressRunRows.push(
    {
      id: "dev-run-12230-1",
      companyId: COMPANY_ID,
      serverSeq: loggedSeq,
      number: "PR-8",
      period: pressRunPeriod,
      status: "logged",
      pressLineId: "dev-press-line-1",
      sectionId: dieId("chan1"),
      dieInstanceId: devCopyId("12230-1"),
      productionDay: loggedShift.productionDay,
      shiftSeq: loggedShift.shiftSeq,
      shiftId: loggedShift.shiftId,
      operatorId,
      supervisorId: ownerId,
      castId: "dev-press-cast-1",
      dieInAt: new Date(loggedStart),
      dieOutAt: new Date(loggedStop),
      startedAt: new Date(loggedStart),
      stoppedAt: new Date(loggedStop),
      discardG: 25_000,
      endsG: 12_800,
      rejectG: 7_000,
      inputG: 310_400,
      inputWeighedG: 310_400,
      goodG: 234_200,
      recoveryBp: 7545,
      balanceG: 31_400,
      billetShortG: 0,
      pressRemark: "Ram slow on the third billet",
      loggedAt: new Date(loggedAt),
      createdBy: ownerId,
      createdAt: new Date(loggedStart),
      updatedAt: new Date(loggedAt),
    },
    {
      id: "dev-run-13090-2-late",
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number: "PR-9",
      period: pressRunPeriod,
      status: "counting",
      pressLineId: "dev-press-line-2",
      sectionId: dieId("tee125"),
      dieInstanceId: devCopyId("13090-2"),
      productionDay: lateShift.productionDay,
      shiftSeq: lateShift.shiftSeq,
      shiftId: lateShift.shiftId,
      operatorId,
      castId: "dev-press-cast-1",
      dieInAt: new Date(lateStart),
      dieOutAt: new Date(lateStop),
      startedAt: new Date(lateStart),
      stoppedAt: new Date(lateStop),
      lateEntry: true,
      createdBy: operatorId,
      createdAt: new Date(todayAt(0.3)),
      updatedAt: new Date(todayAt(0.3)),
    },
  );
  dieIssueRows.push({
    id: "dev-issue-12230-1",
    companyId: COMPANY_ID,
    serverSeq: loggedSeq,
    dieInstanceId: devCopyId("12230-1"),
    pressLineId: "dev-press-line-1",
    pressRunId: "dev-run-12230-1",
    status: "returned",
    issuedAt: new Date(loggedStart - 20 * 60 * 1000),
    issuedBy: ownerId,
    returnedAt: new Date(loggedAt),
    returnedBy: ownerId,
  });
  const runChild = { companyId: COMPANY_ID, createdBy: ownerId };
  const pressRunLineRows: (typeof pressRunLine.$inferInsert)[] = [
    { id: "dev-run-12230-1-line-1", ...runChild, serverSeq: loggedSeq, pressRunId: "dev-run-12230-1", line: 1, cutLengthMm: 3_658, pcs: 80, goodG: 234_200 },
    { id: "dev-run-late-line-1", ...runChild, serverSeq: nextSeq(), pressRunId: "dev-run-13090-2-late", line: 1, cutLengthMm: 3_658, pcs: 60, goodG: 170_000 },
  ];
  const pressBilletRows: (typeof pressBilletUse.$inferInsert)[] = [
    { id: "dev-run-12230-1-billet-1", ...runChild, serverSeq: loggedSeq, pressRunId: "dev-run-12230-1", line: 1, castId: "dev-press-cast-1", lengthMm: 600, count: 4, kgG: 155_200 },
    { id: "dev-run-12230-1-billet-2", ...runChild, serverSeq: loggedSeq, pressRunId: "dev-run-12230-1", line: 2, castId: "dev-press-cast-1", lengthMm: 600, count: 4, kgG: 155_200 },
    { id: "dev-run-late-billet-1", ...runChild, serverSeq: nextSeq(), pressRunId: "dev-run-13090-2-late", line: 1, castId: "dev-press-cast-1", lengthMm: 600, count: 4, kgG: 230_000 },
  ];
  const qcRows: (typeof qcEntry.$inferInsert)[] = [
    { id: "dev-run-12230-1-qc-1", ...runChild, serverSeq: loggedSeq, pressRunId: "dev-run-12230-1", line: 1, pressRunLineId: "dev-run-12230-1-line-1", reasonCodeId: "dev-reason-qc_reject-bend", pcs: 3, kgG: 7_000 },
    { id: "dev-run-late-qc-1", ...runChild, serverSeq: nextSeq(), pressRunId: "dev-run-13090-2-late", line: 1, pcs: 0, kgG: 0 },
  ];
  const downtimeRows: (typeof pressDowntime.$inferInsert)[] = [
    {
      id: "dev-downtime-1",
      companyId: COMPANY_ID,
      serverSeq: loggedSeq,
      pressLineId: "dev-press-line-1",
      pressRunId: "dev-run-12230-1",
      reasonCodeId: "dev-reason-downtime-billet_wait",
      // Inside PR-8's run (and its production day); 18 min, or less right after the day starts.
      startedAt: new Date(pressDayAt(0.25)),
      stoppedAt: new Date(Math.min(pressDayAt(0.25) + 18 * 60 * 1000, pressDayAt(0.4))),
      startedBy: operatorId,
      stoppedBy: operatorId,
    },
  ];
  approvalRows.push({
    id: "dev-approval-late-entry-1",
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    kind: "press_late_entry",
    subjectId: "dev-run-13090-2-late",
    status: "pending",
    requestNote: "Tablet was down on the night shift",
    meta: { reason: "Tablet was down on the night shift", productionDay: lateShift.productionDay, shiftSeq: lateShift.shiftSeq, runNumber: "PR-9" },
    requestedBy: operatorId,
    createdAt: new Date(todayAt(0.3)),
  });

  // FP Wave 2 contracts: one draft die-trial plan (PP-1, FP-PR-23) on the second press, for the
  // trial copy flow; no order line (a trial needs none). The plan book continues after PP-1.
  const pressPlanPeriod = docPeriod("press_plan", new Date(now), DEMO_SETTINGS.timezone);
  const trialPlanRows: (typeof pressPlan.$inferInsert)[] = [
    {
      id: "dev-plan-trial-1",
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      number: "PP-1",
      period: pressPlanPeriod,
      status: "draft",
      purpose: "die_trial",
      pressLineId: "dev-press-line-2",
      windowStart: new Date(todayWindowStart),
      windowEnd: new Date(todayWindowStart + 12 * 60 * 60 * 1000),
      note: "Trial of a new copy",
      createdBy: ownerId,
    },
  ];
  // A released die trial plan (PP-2) holding the trial runs PR-5..PR-7 of Tee.
  trialPlanRows.push({
    id: "dev-plan-trial-2",
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    number: "PP-2",
    period: pressPlanPeriod,
    status: "released",
    purpose: "die_trial",
    pressLineId: "dev-press-line-1",
    windowStart: new Date(todayWindowStart),
    windowEnd: new Date(todayWindowStart + 12 * 60 * 60 * 1000),
    note: "Trial of the new Tee copies",
    releasedAt: new Date(todayAt(0.07)),
    releasedBy: ownerId,
    createdBy: ownerId,
  });
  const trialPlanDieRows: (typeof pressPlanDie.$inferInsert)[] = [
    { id: "dev-plan-trial-1-die-1", companyId: COMPANY_ID, serverSeq: nextSeq(), pressPlanId: "dev-plan-trial-1", sectionId: dieId("patti1"), sortOrder: 1, createdBy: ownerId },
  ];
  // Today's board (dev-seed-press.ts): two released production plans on order lines, a run on Press 2
  // right now, two more logged runs (rejects, a long stop) and queued runs behind them.
  const pressExtras = buildPressExtras({
    companyId: COMPANY_ID,
    clock,
    settings: DEMO_SETTINGS,
    runPeriod: pressRunPeriod,
    planPeriod: pressPlanPeriod,
    firstRunNo: pressRunRows.length + 1,
    firstPlanNo: trialPlanRows.length + 1,
    ownerId,
    supervisorId: users.supervisor.id,
    pressUserId: users.press.id,
    operatorId,
    nextSeq,
    sectionId: dieId,
    copyId: devCopyId,
    orderLine: (order, no) => {
      const row = orderSeed.lines.find((l) => l.id === `dev-sol-${order}-${no}`);
      if (!row) throw new Error(`dev-seed: no order line ${order}/${no}`);
      return row;
    },
  });
  for (const run of pressRunRows) {
    const joined = pressExtras.attach.get(run.id!);
    if (joined) Object.assign(run, joined);
  }
  pressRunRows.push(...pressExtras.runs);
  dieIssueRows.push(...pressExtras.issues);
  pressRunLineRows.push(...pressExtras.runLines);
  pressBilletRows.push(...pressExtras.billets);
  qcRows.push(...pressExtras.qc);
  downtimeRows.push(...pressExtras.downtimes);
  readingRows.push(...pressExtras.readings);
  approvalRows.push(...orderSeed.approvals, ...dieExtras.approvals);
  // Ageing (W3-AG-S): PR-8's line on two trolleys, AG-1 released, AG-2 in the oven now.
  const ageingDemo = buildAgeingDemo({
    companyId: COMPANY_ID,
    clock,
    ownerId,
    supervisorId: users.supervisor.id,
    pressUserId: users.press.id,
    nextSeq,
    shiftAt: (ms) => shiftAt(DEMO_SETTINGS, ms),
    period: docPeriod("ageing", new Date(now), DEMO_SETTINGS.timezone),
    sectionId: dieId("chan1"),
    copyId: devCopyId("12230-1"),
    castId: "dev-press-cast-1",
    pressRunId: "dev-run-12230-1",
    pressRunLineId: "dev-run-12230-1-line-1",
    lineGoodG: 234_200,
    linePcs: 80,
    ovenId: "dev-ageing-oven-1",
    recipeId: (alloy, temper) => `dev-ageing-recipe-${alloy}-${temper.toLowerCase()}`,
  });
  approvalRows.push(...ageingDemo.approvals);
  const pressPlanSeriesRows: (typeof docSeries.$inferInsert)[] = [
    { id: `dev-series-press_plan-${pressPlanPeriod}`, companyId: COMPANY_ID, docType: "press_plan", period: pressPlanPeriod, value: trialPlanRows.length + pressExtras.plans.length, createdBy: ownerId },
  ];
  // Foundry masters (FP-FD-01/09; Q-FD-1, Q-FD-8): F1 6 t 127 mm; 6063 and 6061 with the spec's limits.
  const furnaceRows: (typeof furnace.$inferInsert)[] = [
    { id: "dev-furnace-f1", companyId: COMPANY_ID, serverSeq: nextSeq(), ...FURNACE_SEED, sortOrder: 1, createdBy: ownerId },
  ];
  const alloyRows: (typeof alloy.$inferInsert)[] = (["6063", "6061"] as const).map((code, i) => ({
    id: `dev-alloy-${code}`,
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    code,
    name: `AA ${code}`,
    note: "Limits seeded from the spec; the owner confirms them (Q-FD-1).",
    sortOrder: i + 1,
    createdBy: ownerId,
  }));
  const alloyLimitRows: (typeof alloyLimit.$inferInsert)[] = (["6063", "6061"] as const).flatMap((code) =>
    ALLOY_LIMIT_SEEDS[code].map((l) => ({
      id: `dev-alloy-${code}-${l.element}`,
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      alloyId: `dev-alloy-${code}`,
      element: l.element,
      minPpm: l.minPpm,
      maxPpm: l.maxPpm,
      createdBy: ownerId,
    })),
  );
  // An approved exception: Tejura & Sons may use KD Extrusion's 12230-1 (a manager closes it from the issues page).
  approvalRows.push({
    id: "dev-approval-12230-1-tejura",
    companyId: COMPANY_ID,
    serverSeq: nextSeq(),
    kind: "die_owner_override",
    subjectId: devCopyId("12230-1"),
    status: "approved",
    requestNote: "KD asked us to cover the Tejura order",
    meta: {
      attemptedCustomerId: customerId("tejura"),
      purpose: "pack",
      closedAt: null,
      code: "12230-1",
      sectionId: dieId("chan1"),
      ownerCustomerId: customerId(CUSTOMERS[0]!.key),
    },
    requestedBy: officeId,
    decidedBy: ownerId,
    decidedAt: new Date(pastAt(2, 10)),
    createdAt: new Date(pastAt(2, 9)),
    updatedAt: new Date(pastAt(2, 10)),
  });
  const ownedSectionId = dieId("chan1");
  const ownedBy = customerId(CUSTOMERS[0]!.key);

  // Sequence now covers everything allocated above; packing-list codes continue from it.
  const sequenceAfterData = seq;

  // Collector demo rows (BACKLOG 46, simulated or not as marked). Alerts are all ended (so none is "open" and
  // the unique open-alert index is untouched); three are unacknowledged, one per e2e width, so parallel
  // specs never acknowledge the same one. Inbox files: two per width (one to attach, one to dismiss), plus a
  // simulated one that can only be dismissed. Their R2 objects do not exist: attach/dismiss never read them.
  const collectorMeltRows: (typeof melt.$inferInsert)[] = [
    // m-6: a locked melt reads like one: times in lock order (charging start, casting end) inside
    // the cast's day, and its figures (2.6 t charged, the 2.4 t of billets the cast opened with).
    {
      id: "dev-melt-1",
      companyId: COMPANY_ID,
      serverSeq: nextSeq(),
      castId: "dev-press-cast-1",
      seq: 1,
      alloy: "6063",
      alloyId: "dev-alloy-6063",
      furnaceId: "dev-furnace-f1",
      status: "locked",
      preheatStartAt: new Date(pastAt(2, 6)),
      chargingStartAt: new Date(pastAt(2, 6.75)),
      chargingEndAt: new Date(pastAt(2, 8.5)),
      castingStartAt: new Date(pastAt(2, 9)),
      castingEndAt: new Date(pastAt(2, 11)),
      inputG: 2_600_000,
      logsPcs: 40,
      logsLengthMm: 6_000,
      logsG: billetOpeningG,
      drossG: 130_000,
      returnsG: 70_000,
      createdBy: ownerId,
    } as typeof melt.$inferInsert,
  ];
  const alertAt = (minAgo: number) => new Date(now - minAgo * 60_000);
  const collectorAlertRows: (typeof pressAlert.$inferInsert)[] = [
    ...([375, 820, 1280] as const).map((w, i) => ({
      id: `dev-alert-${w}`,
      companyId: COMPANY_ID,
      pressLineId: "dev-press-line-1",
      metric: (["ram_speed", "billet_temp", "exit_temp"] as const)[i]!,
      direction: "high" as const,
      limitX10: [120, 4800, 5600][i]!,
      peakX10: [131, 5010, 5890][i]!,
      frames: 4 + i,
      simulated: false,
      startedAt: alertAt(20),
      lastAt: alertAt(18),
      endedAt: alertAt(18),
    })),
    {
      id: "dev-alert-acked",
      companyId: COMPANY_ID,
      pressLineId: "dev-press-line-2",
      metric: "pressure" as const,
      direction: "low" as const,
      limitX10: 2200,
      peakX10: 1890,
      frames: 3,
      simulated: false,
      startedAt: alertAt(40),
      lastAt: alertAt(38),
      endedAt: alertAt(38),
      acknowledgedAt: alertAt(30),
      acknowledgedBy: ownerId,
    },
    {
      id: "dev-alert-sim",
      companyId: COMPANY_ID,
      pressLineId: "dev-press-line-2",
      metric: "container_temp" as const,
      direction: "high" as const,
      limitX10: 4300,
      peakX10: 4450,
      frames: 2,
      simulated: true,
      startedAt: alertAt(60),
      lastAt: alertAt(59),
      endedAt: alertAt(59),
    },
  ];
  const inboxRow = (id: string, name: string, over: Partial<typeof spectroInbox.$inferInsert> = {}): typeof spectroInbox.$inferInsert => ({
    id,
    companyId: COMPANY_ID,
    sha256: `${id.replace(/[^a-z0-9]/g, "")}`.padEnd(64, "0").slice(0, 64),
    fileName: name,
    mime: "text/csv",
    sizeBytes: 2_048,
    fileKey: `${COMPANY_ID}/spectro/${id}`,
    status: "pending_review",
    simulated: false,
    capturedAt: alertAt(90),
    sampleRef: name.replace(/\.csv$/, ""),
    instrument: "Spectro 1",
    valuesPpm: { si: 4_500, fe: 2_000, mg: 5_200 },
    uploadedAt: alertAt(85),
    ...over,
  });
  const collectorInboxRows: (typeof spectroInbox.$inferInsert)[] = [
    ...([375, 820, 1280] as const).flatMap((w) => [
      inboxRow(`dev-inbox-${w}-attach`, `6063-${w}-attach.csv`),
      inboxRow(`dev-inbox-${w}-dismiss`, `6063-${w}-dismiss.csv`),
    ]),
    inboxRow("dev-inbox-sim", "simulated-6063.csv", { simulated: true }),
  ];

  const statements: Statement[] = [
    // Reset: children before parents (several FKs are RESTRICT).
    // I-4: the password-reset throttle (5 per 15 min per address and per IP) would refuse the
    // forgot-password e2e on a rerun inside the window. Dev seed only (the route is dev-gated).
    db.delete(authThrottle),
    // Customer portal (Wave 3): certificates hold keys to dispatches and customers, grants to dies.
    db.delete(testCertificate).where(eq(testCertificate.companyId, COMPANY_ID)),
    db.delete(customerPortalSection).where(eq(customerPortalSection.companyId, COMPANY_ID)),
    db.delete(customerPortalUser).where(eq(customerPortalUser.companyId, COMPANY_ID)),
    db.delete(packingListLine).where(eq(packingListLine.companyId, COMPANY_ID)),
    db.delete(packingListDispatch).where(eq(packingListDispatch.companyId, COMPANY_ID)),
    db.delete(packingList).where(eq(packingList.companyId, COMPANY_ID)),
    // FP Wave 1 rows made in the app since the last seed: press runs and plans hold keys to order
    // lines, copies, casts and reason codes; transfers and pack rejects to bundles and groups.
    // Wave 2 run children (billets hold keys to casts, downtime to lines and reason codes, die
    // remarks to copies): before the runs, casts, lines, reason codes and copies they point at.
    db.delete(pressAlert).where(eq(pressAlert.companyId, COMPANY_ID)),
    db.delete(pressAlertThreshold).where(eq(pressAlertThreshold.companyId, COMPANY_ID)),
    db.delete(pressRunCollector).where(eq(pressRunCollector.companyId, COMPANY_ID)),
    db.delete(pressCollectorFrame).where(eq(pressCollectorFrame.companyId, COMPANY_ID)),
    db.delete(qcEntry).where(eq(qcEntry.companyId, COMPANY_ID)),
    db.delete(pressRunLine).where(eq(pressRunLine.companyId, COMPANY_ID)),
    db.delete(pressBilletUse).where(eq(pressBilletUse.companyId, COMPANY_ID)),
    db.delete(pressDowntime).where(eq(pressDowntime.companyId, COMPANY_ID)),
    db.delete(pressRemark).where(eq(pressRemark.companyId, COMPANY_ID)),
    db.delete(dieRemark).where(eq(dieRemark.companyId, COMPANY_ID)),
    db.delete(dieIssue).where(eq(dieIssue.companyId, COMPANY_ID)),
    db.delete(pressRun).where(eq(pressRun.companyId, COMPANY_ID)),
    db.delete(pressPlanLine).where(eq(pressPlanLine.companyId, COMPANY_ID)),
    db.delete(pressPlanDie).where(eq(pressPlanDie.companyId, COMPANY_ID)),
    db.delete(pressPlan).where(eq(pressPlan.companyId, COMPANY_ID)),
    db.delete(pressLine).where(eq(pressLine.companyId, COMPANY_ID)),
    // Ageing (W3-AG-C): what the app loaded since the last seed, children first (rows point at dies,
    // batches at trolleys / ovens / recipes with RESTRICT), then the masters.
    db.delete(ageingHardness).where(eq(ageingHardness.companyId, COMPANY_ID)),
    db.delete(ageingTempLog).where(eq(ageingTempLog.companyId, COMPANY_ID)),
    db.delete(ageingRow).where(eq(ageingRow.companyId, COMPANY_ID)),
    db.delete(ageingBatch).where(eq(ageingBatch.companyId, COMPANY_ID)),
    db.delete(ageingRecipe).where(eq(ageingRecipe.companyId, COMPANY_ID)),
    db.delete(trolley).where(eq(trolley.companyId, COMPANY_ID)),
    db.delete(ageingOven).where(eq(ageingOven.companyId, COMPANY_ID)),
    db.delete(reasonCode).where(eq(reasonCode.companyId, COMPANY_ID)),
    // Printing: jobs hold keys to profiles and templates (RESTRICT); the edge node goes with them.
    db.delete(printLog).where(eq(printLog.companyId, COMPANY_ID)),
    db.delete(printerProfile).where(eq(printerProfile.companyId, COMPANY_ID)),
    db.delete(labelTemplate).where(eq(labelTemplate.companyId, COMPANY_ID)),
    db.delete(edgeNodeDeployment).where(eq(edgeNodeDeployment.companyId, COMPANY_ID)),
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
    // Collector rows (W4-COLLECTORS): the inbox points at melts and spectro results, alerts and frames at lines and runs.
    db.delete(spectroInbox).where(eq(spectroInbox.companyId, COMPANY_ID)),
    db.delete(spectroResult).where(eq(spectroResult.companyId, COMPANY_ID)),
    db.delete(meltChemical).where(eq(meltChemical.companyId, COMPANY_ID)),
    db.delete(meltOutput).where(eq(meltOutput.companyId, COMPANY_ID)),
    db.delete(meltInput).where(eq(meltInput.companyId, COMPANY_ID)),
    db.delete(melt).where(eq(melt.companyId, COMPANY_ID)),
    db.delete(cast).where(eq(cast.companyId, COMPANY_ID)),
    db.delete(returnStream).where(eq(returnStream.companyId, COMPANY_ID)),
    // Wave 2 foundry masters, after the melts and casts that point at them.
    db.delete(alloyLimit).where(eq(alloyLimit.companyId, COMPANY_ID)),
    db.delete(alloy).where(eq(alloy.companyId, COMPANY_ID)),
    db.delete(furnace).where(eq(furnace.companyId, COMPANY_ID)),
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
    db.delete(dieWork).where(eq(dieWork.companyId, COMPANY_ID)),
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
    db.insert(membership).values(
      memberKeys.map((key) => ({
        id: `dev-membership-${key}`,
        userId: users[key].id,
        companyId: COMPANY_ID,
        role: DEV_MEMBER_ROLES[key],
      })),
    ),
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
    // Die room demo: sections, makers, bands and copies, then readings (order lines pin copies and readings).
    db.update(die).set({ ownerCustomerId: ownedBy }).where(and(eq(die.id, ownedSectionId), eq(die.companyId, COMPANY_ID))),
    ...insertChunks(db, dieBand, dieBandRows),
    ...insertChunks(db, dieMaker, dieExtras.makers),
    ...insertChunks(db, dieInstance, copyRows),
    ...insertChunks(db, dieMakerJob, dieExtras.makerJobs),
    ...insertChunks(db, nitridingLog, dieExtras.nitriding),
    ...insertChunks(db, dieTierChange, copyTierRows),
    ...insertChunks(db, dieWeightReading, readingRows),
    ...insertChunks(db, salesOrder, orderSeed.orders),
    ...insertChunks(db, salesOrderLine, orderSeed.lines),
    ...defaultLocationStatements(db, COMPANY_ID, { userId: ownerId, idFor: devLocationId }),
    ...insertChunks(db, bundleGroup, groups),
    ...insertChunks(db, bundle, bundleRows),
    ...insertChunks(db, bundleStatusEvent, eventRows),
    // Plant stock moves (append-only) and the stock count that closed two days ago.
    ...insertChunks(db, bundleTransfer, orderSeed.transfers),
    ...insertChunks(db, countSession, [countSeed.session]),
    ...insertChunks(db, countLocation, countSeed.locations),
    ...insertChunks(db, countSeen, countSeed.seen),
    ...insertChunks(db, countLine, countSeed.lines),
    ...insertChunks(db, countTally, countSeed.tally),
    ...insertChunks(db, transporter, [
      { id: "dev-transporter-1", companyId: COMPANY_ID, name: "Shree Logistics", phone: "+91 98250 70011", createdBy: ownerId },
      { id: "dev-transporter-2", companyId: COMPANY_ID, name: "Balaji Roadways", phone: "+91 98240 60022", createdBy: ownerId },
      { id: "dev-transporter-3", companyId: COMPANY_ID, name: "Maruti Freight Carriers", phone: null, active: false, createdBy: ownerId },
    ]),
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
    ...insertChunks(db, auditLog, [...orderSeed.audits, ...dieExtras.audits, ...pressExtras.audits, ...countSeed.audits]),
    ...insertChunks(db, docSeries, [...dieExtras.series, ...countSeed.series]),
    // Printing: one template and printer, two labels waiting, a plant node that has not connected.
    ...insertChunks(db, labelTemplate, [printing.template]),
    ...insertChunks(db, printerProfile, [printing.profile]),
    ...insertChunks(db, printLog, printing.jobs),
    ...insertChunks(db, edgeNodeDeployment, [printing.node]),
    ...insertChunks(db, storeItem, storeSeed.items),
    ...insertChunks(db, storeTxn, storeSeed.txns),
    ...insertChunks(db, stockLedger, storeSeed.ledger),
    ...insertChunks(db, docSeries, storeSeed.series),
    // FP Wave 1 masters: one press (tonnage left for the plant), the demo transporter, every
    // default reason code.
    ...insertChunks(db, pressLine, [
      { id: "dev-press-line-1", companyId: COMPANY_ID, code: "P1", name: "Press 1", sortOrder: 1, createdBy: ownerId },
      // Wave 2: a second press for the trial plan (tonnage left for the plant too).
      { id: "dev-press-line-2", companyId: COMPANY_ID, code: "P2", name: "Press 2", sortOrder: 2, createdBy: ownerId },
    ]),
    // FP Wave 2 foundry masters and the foundry sheet's return streams.
    ...insertChunks(db, furnace, furnaceRows),
    ...insertChunks(db, alloy, alloyRows),
    ...insertChunks(db, alloyLimit, alloyLimitRows),
    // Ageing masters (W3-AG-C): one active oven, trolley T-1, the two 6063 full-cycle recipes
    // (T5, T6) published; W3-AG-S loads PR-8 onto T-1 / T-2 below. The other suggestions stay unsaved (Q1: a manager publishes).
    ...insertChunks(db, ageingOven, [
      { id: "dev-ageing-oven-1", companyId: COMPANY_ID, serverSeq: nextSeq(), ...AGEING_OVEN_SEED, status: "active", sortOrder: 1, createdBy: ownerId },
    ]),
    ...insertChunks(db, trolley, [
      { id: "dev-trolley-1", companyId: COMPANY_ID, serverSeq: nextSeq(), code: "T-1", capacityG: 2_000_000, status: "active", sortOrder: 1, createdBy: ownerId },
    ]),
    ...insertChunks(
      db,
      ageingRecipe,
      AGEING_RECIPE_SUGGESTIONS.filter((r) => r.alloy === "6063" && r.kind === "full").map((r) => ({
        id: `dev-ageing-recipe-${r.alloy}-${r.temper.toLowerCase()}`,
        companyId: COMPANY_ID,
        serverSeq: nextSeq(),
        ...r,
        status: "active" as const,
        note: "Suggested figures (spec Q1); the plant confirms them.",
        createdBy: ownerId,
      })),
    ),
    // W3-AG-S: a second trolley and the two demo batches (after their masters).
    ...insertChunks(db, trolley, ageingDemo.trolleys),
    ...insertChunks(db, ageingBatch, ageingDemo.batches),
    ...insertChunks(db, ageingRow, ageingDemo.rows),
    ...insertChunks(db, ageingTempLog, ageingDemo.readings),
    ...insertChunks(db, ageingHardness, ageingDemo.hardness),
    ...insertChunks(db, docSeries, ageingDemo.series),
    ...(defaultReturnStreamStatements(db as never, COMPANY_ID, { userId: ownerId, seq: 0 }) as Statement[]),
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
    ...insertChunks(db, cast, castRows),
    ...insertChunks(db, docSeries, castSeriesRows),
    // Plans before the runs that point at them (PP-2 holds the die trial runs).
    ...insertChunks(db, pressPlan, [...trialPlanRows, ...pressExtras.plans]),
    ...insertChunks(db, pressPlanDie, [...trialPlanDieRows, ...pressExtras.planDies]),
    ...insertChunks(db, pressPlanLine, pressExtras.planLines),
    ...insertChunks(db, pressRun, pressRunRows),
    ...insertChunks(db, docSeries, pressRunSeriesRows.map((r) => ({ ...r, value: pressRunRows.length }))),
    ...insertChunks(db, dieIssue, dieIssueRows),
    ...insertChunks(db, pressRunLine, pressRunLineRows),
    ...insertChunks(db, pressBilletUse, pressBilletRows),
    ...insertChunks(db, qcEntry, qcRows),
    ...insertChunks(db, pressDowntime, downtimeRows),
    ...insertChunks(db, pressRemark, pressExtras.pressRemarks),
    ...insertChunks(db, dieRemark, pressExtras.dieRemarks),
    ...insertChunks(db, docSeries, pressPlanSeriesRows),
    // Collector UIs (BACKLOG 46): a melt for the inbox's picker, alerts and files to work through.
    ...insertChunks(db, melt, collectorMeltRows),
    ...insertChunks(db, pressAlert, collectorAlertRows),
    ...insertChunks(db, spectroInbox, collectorInboxRows),
  ];
  await atomicBatch(db, statements);

  // 3b. Ledger of the Wave 2 press demo: the cast's billet opening, then the logged run's close
  //     rows exactly as press.runs.close posts them (billet out; butt to DISCARD, ends and
  //     rejects to PLANT-SCRAP). Stream ids are only known once the default streams exist.
  const streams = await db
    .select({ id: returnStream.id, code: returnStream.code })
    .from(returnStream)
    .where(eq(returnStream.companyId, COMPANY_ID));
  const streamOf = (code: string) => {
    const hit = streams.find((r) => r.code === code);
    if (!hit) throw new Error(`dev-seed: return stream ${code} missing`);
    return hit.id;
  };
  const pressLedger = (line: number, itemKind: "billet" | "return_stream", itemRef: string, locationCode: string, qtyG: number, reason: string) => ({
    id: `dev-ledger-press-run-12230-1-${line}`,
    companyId: COMPANY_ID,
    serverSeq: loggedSeq,
    voucherType: "press_run" as const,
    voucherId: "dev-run-12230-1",
    line,
    itemKind,
    itemRef,
    locationId: devLocationId(locationCode),
    qtyG,
    postedAt: new Date(loggedAt),
    reason,
    createdBy: ownerId,
  });
  await atomicBatch(db, [
    db.insert(stockLedger).values({
      id: "dev-ledger-press-cast-1-opening",
      companyId: COMPANY_ID,
      serverSeq: castRows[0]!.serverSeq!,
      voucherType: "opening",
      voucherId: "dev-press-cast-1",
      line: 1,
      itemKind: "billet",
      itemRef: "dev-press-cast-1",
      locationId: devLocationId("BILLET"),
      qtyG: billetOpeningG,
      postedAt: new Date(pastAt(1, 18)),
      reason: "Billets on hand from the paper cast sheet",
      createdBy: ownerId,
    }),
    db.insert(stockLedger).values([
      pressLedger(1, "billet", "dev-press-cast-1", "BILLET", -310_400, "PR-8 billets"),
      pressLedger(2, "return_stream", streamOf("DISCARD"), "PLANT-SCRAP", 25_000, "PR-8 butt"),
      pressLedger(3, "return_stream", streamOf("PLANT-SCRAP"), "PLANT-SCRAP", 12_800, "PR-8 ends"),
      pressLedger(4, "return_stream", streamOf("PLANT-SCRAP"), "PLANT-SCRAP", 7_000, "PR-8 rejects"),
    ]),
    // The other runs logged today (PR-11, PR-12): the same four rows each.
    ...insertChunks(
      db,
      stockLedger,
      pressExtras.loggedLedger.flatMap((run) =>
        pressCloseLedger(run, { companyId: COMPANY_ID, ownerId, streamId: streamOf, location: devLocationId, castId: "dev-press-cast-1" }),
      ),
    ),
  ] as Statement[]);

  // 4. Packing lists for completed dispatches, built by the router's own writer so the
  //    snapshot shape matches production. Then backdate them to the completion time.
  //    done-1 (KD): rev 1 and a rev 2 (branding off). done-2 (Royal, opened from SO-8): one list.
  //    done-3 + done-4 (Tejura, SO-5): one list each, then folded into one combined list.
  const completed = [c1, c2, c3, c4];
  const sessionUser = { user: { id: ownerId } } as never;
  const plByDispatch = new Map<string, { plId: string; plNumber: string; plAt: Date; row: typeof dispatch.$inferSelect }>();
  for (const plan of completed) {
    const found = await db.query.dispatch.findFirst({ where: eq(dispatch.id, plan.id) });
    if (!found) throw new Error(`dev-seed: dispatch ${plan.id} missing after insert`);
    // FP-PK-07: party numbers from the customer's own series, as pack allocates them (the dispatched
    // bundles first, then the ones packed for the customer's open orders).
    const policy = PARTY_POLICIES[plan.customerKey];
    if (policy) {
      const members = [...plan.members].sort((a, b) => a.serial.localeCompare(b.serial, "en", { numeric: true }));
      const { numbers } = await allocatePartyBundleNumbers(
        db,
        COMPANY_ID,
        customerId(plan.customerKey),
        policy,
        new Date(Math.min(...members.map((m) => m.createdAt))),
        members.length,
        ownerId,
      );
      await atomicBatch(
        db,
        members.map((m, k) => db.update(bundle).set({ partyNo: numbers[k]! }).where(eq(bundle.id, m.id))),
      );
      const stocked = (orderSeed.partyBundles.find((p) => p.customerKey === plan.customerKey)?.bundles ?? []).sort((a, b) =>
        a.serial.localeCompare(b.serial, "en", { numeric: true }),
      );
      if (stocked.length > 0) {
        const more = await allocatePartyBundleNumbers(
          db,
          COMPANY_ID,
          customerId(plan.customerKey),
          policy,
          new Date(Math.min(...stocked.map((m) => m.createdAt))),
          stocked.length,
          ownerId,
        );
        await atomicBatch(
          db,
          stocked.map((m, k) => db.update(bundle).set({ partyNo: more.numbers[k]! }).where(eq(bundle.id, m.id))),
        );
      }
      // D15: kd's monthly party number reads like a plant serial. Keep the real collision in the
      // demo: one plant-stock bundle whose plant number is kd's first party number, so a scan of
      // that code is `ambiguous` (never a silent pick of either bundle).
      if (policy === "monthly") {
        const source = bundleRows.find((r) => r.status === "available" && !r.currentDispatchId);
        if (source) {
          const clashId = "dev-bundle-party-clash";
          // The plant series must be past the party numbers (26J1..26J36): the first bundle packed in the
          // month would otherwise be given "26J1" and collide with the clash bundle, and every bundle after
          // it with a party number of the monthly customer. The demo plant is at about 4,000 a month.
          const clashPeriod = docPeriod("bundle", new Date(source.createdAt as Date), DEMO_SETTINGS.timezone);
          const clashSeq = Math.max(4_000, Number(/(\d+)$/.exec(numbers[0]!)?.[1] ?? 0));
          await atomicBatch(db, [
            db
              .delete(docSeries)
              .where(and(eq(docSeries.companyId, COMPANY_ID), eq(docSeries.docType, "bundle"), eq(docSeries.period, clashPeriod))),
            db.insert(docSeries).values({
              id: `dev-series-bundle-${clashPeriod}`,
              companyId: COMPANY_ID,
              docType: "bundle",
              period: clashPeriod,
              value: clashSeq,
              createdBy: ownerId,
            }),
            db.insert(bundle).values({ ...source, id: clashId, serial: numbers[0]!, partyNo: numbers[0]!, numberStyle: "plant" }),
            db.insert(bundleStatusEvent).values({
              id: `${clashId}-evt-0`,
              companyId: COMPANY_ID,
              bundleId: clashId,
              fromStatus: null,
              toStatus: "available",
              reason: "receipt",
              actorId: operatorId,
              dispatchId: null,
              at: source.createdAt as Date,
            }),
          ]);
        }
      }
    }
    // PL numbers come from the PL book series, as dispatch.complete assigns them (PL-8).
    const { number: plNumber } = await nextDocNumber(db, COMPANY_ID, "pl", new Date(plan.completedAt ?? now), ownerId);
    await db.update(dispatch).set({ plNumber }).where(eq(dispatch.id, plan.id));
    const dispatchRow = { ...found, plNumber };
    const { plId, statements: plStatements } = await packingListWriteBatch(db, {
      companyId: COMPANY_ID,
      dispatchRow,
      plNumber,
      session: sessionUser,
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
    plByDispatch.set(plan.id, { plId, plNumber, plAt, row: dispatchRow });

    // FP-PK-13: the first list was regenerated once (branding off): rev 2 under the same number,
    // rev 1 kept as sent.
    if (plan.id === c1.id) {
      const { plId: rev2Id, statements: rev2Statements } = await packingListWriteBatch(db, {
        companyId: COMPANY_ID,
        dispatchRow,
        plNumber,
        session: sessionUser,
        revision: 2,
        supersedesId: plId,
        showBranding: false,
        auditAction: "packingList.regenerate",
        auditMeta: { dispatchId: plan.id, previousId: plId, code: plNumber, revision: 2 },
      });
      await atomicBatch(db, rev2Statements);
      const rev2At = new Date(plAt.getTime() + 3_600_000);
      const rev2Row = await db.query.packingList.findFirst({ where: eq(packingList.id, rev2Id) });
      if (rev2Row) {
        await db
          .update(packingList)
          .set({ createdAt: rev2At, snapshot: { ...rev2Row.snapshot, generatedAt: rev2At.toISOString() } })
          .where(eq(packingList.id, rev2Id));
      }
    }
  }

  // FP-PK-13: Tejura's two trucks (done-3, done-4) are folded into one combined list with a number of
  // its own, exactly as packingList.combine writes it; each folded list keeps its number and points at it.
  {
    const first = plByDispatch.get(c3.id)!;
    const second = plByDispatch.get(c4.id)!;
    const combinedNumber = (await nextDocNumber(db, COMPANY_ID, "pl", new Date(c4.completedAt ?? now), ownerId)).number;
    const combinedId = "dev-pl-combined-1";
    const { statements: combineStatements } = await packingListWriteBatch(db, {
      companyId: COMPANY_ID,
      dispatchRow: first.row,
      extraDispatches: [second.row],
      plNumber: combinedNumber,
      session: sessionUser,
      plId: combinedId,
      auditAction: "packingList.combine",
      auditMeta: {
        code: combinedNumber,
        from: [first, second].map((p) => ({ id: p.plId, code: p.plNumber })),
        dispatchIds: [c3.id, c4.id],
      },
    });
    await atomicBatch(db, [
      ...combineStatements,
      db.update(packingList).set({ combinedIntoId: combinedId }).where(inArray(packingList.id, [first.plId, second.plId])),
    ]);
    const combinedAt = new Date(second.plAt.getTime() + 2 * 60_000);
    const combinedRow = await db.query.packingList.findFirst({ where: eq(packingList.id, combinedId) });
    if (combinedRow) {
      await db
        .update(packingList)
        .set({ createdAt: combinedAt, snapshot: { ...combinedRow.snapshot, generatedAt: combinedAt.toISOString() } })
        .where(eq(packingList.id, combinedId));
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

  // 7. Customer portal (Wave 3): KD's party login, two granted sections, a portal booking, a certificate.
  await seedPortalRows(db, {
    companyId: COMPANY_ID,
    partyUserId,
    password,
    officeId,
    now,
  });

  const bundlesByStatus: Record<string, number> = {};
  for (const member of bundles) bundlesByStatus[member.status] = (bundlesByStatus[member.status] ?? 0) + 1;

  const result: SeedResult = {
    ok: true,
    status: 200,
    message: "Seeded Fourcubes demo company (reset and re-created)",
    companyId: COMPANY_ID,
    accounts: Object.fromEntries(
      (Object.keys(DEV_ACCOUNTS) as DevAccountKey[]).map((key) => [key, DEV_ACCOUNTS[key].email]),
    ) as Record<DevAccountKey, string>,
    createdUsers,
    counts: {
      users: memberKeys.length + 2,
      members: memberKeys.length,
      customers: customerRows.length,
      dies: dieRows.length,
      dieBands: dieBandRows.length,
      dieCopies: copyRows.length,
      dieReadings: readingRows.length,
      dieTierChanges: copyTierRows.length,
      dieIssues: dieIssueRows.length,
      dieMakers: dieExtras.makers.length,
      dieMakerJobs: dieExtras.makerJobs.length,
      nitridingLogs: dieExtras.nitriding.length,
      salesOrders: orderSeed.orders.length,
      salesOrderLines: orderSeed.lines.length,
      bundleTransfers: orderSeed.transfers.length,
      pressPlans: trialPlanRows.length + pressExtras.plans.length,
      pressRuns: pressRunRows.length,
      casts: castRows.length,
      packingSessions: groups.length,
      // + the one plant-stock bundle whose number clashes with KD's first party number.
      bundles: bundleRows.length + 1,
      dispatches: dispatchRows.length,
      // 6 rows: done-1 (rev 1, rev 2), done-2, done-3, done-4 and the combined list.
      packingLists: 6,
      transporters: 3,
      storeItems: storeSeed.items.length,
      storeEntries: storeSeed.txns.length,
      locations: DEFAULT_LOCATIONS.length,
      countSessions: 1,
      countSeen: countSeed.seen.length,
      printJobs: printing.jobs.length,
      approvals: approvalRows.length,
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
