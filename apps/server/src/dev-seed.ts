import { createAuth } from "@orrn/auth";
import { atomicBatch, type createDb } from "@orrn/db";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem, type DispatchStatus } from "@orrn/db/schema/dispatch";
import {
  bundle,
  bundleGroup,
  bundleStatusEvent,
  type BundleStatus,
} from "@orrn/db/schema/inventory";
import { packingList, packingListLine } from "@orrn/db/schema/packing";
import { auditLog } from "@orrn/db/schema/audit";
import { companySequence } from "@orrn/db/schema/sync";
import { company, membership, platformAdmin } from "@orrn/db/schema/tenant";
import { packingListWriteBatch } from "@orrn/server/routers/packingList";
import { formatBundleSerial, formatGroupCode } from "@orrn/server/lib/bundleSerial";
import { formatDispatchCode } from "@orrn/server/lib/dispatchCode";
import { and, eq, getTableColumns, inArray, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { DEV_ACCOUNTS, type DevAccountKey } from "./dev-accounts";

type Db = ReturnType<typeof createDb>;
type Statement = BatchItem<"sqlite">;

/** D1 rejects statements with more than 100 bound parameters. */
const MAX_PARAMS = 100;
const COMPANY_ID = "dev-company-orrn";
const LENGTH_12FT_MM = 3658;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** "All modules on" (see `visibleItems` in the nav spec). */
const ALL_MODULES = ["customers", "dies", "bundles", "dispatches"];

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
    staff: await ensureUser(db, "staff", password),
  };
  const createdUsers = (Object.keys(users) as DevAccountKey[]).filter((key) => users[key].created);
  const ownerId = users.owner.id;
  const operatorId = users.operator.id;

  // A user can belong to one company only; never silently move someone out of another tenant.
  const elsewhere = await db
    .select({ userId: membership.userId, companyId: membership.companyId })
    .from(membership)
    .where(
      and(
        inArray(membership.userId, [ownerId, operatorId, users.viewer.id]),
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

  // Sequence now covers everything allocated above; packing-list codes continue from it.
  const sequenceAfterData = seq;

  const statements: Statement[] = [
    // Reset: children before parents (several FKs are RESTRICT).
    db.delete(packingListLine).where(eq(packingListLine.companyId, COMPANY_ID)),
    db.delete(packingList).where(eq(packingList.companyId, COMPANY_ID)),
    db.delete(dispatchItem).where(eq(dispatchItem.companyId, COMPANY_ID)),
    db.delete(bundleStatusEvent).where(eq(bundleStatusEvent.companyId, COMPANY_ID)),
    db.delete(bundle).where(eq(bundle.companyId, COMPANY_ID)),
    db.delete(bundleGroup).where(eq(bundleGroup.companyId, COMPANY_ID)),
    db.delete(dispatch).where(eq(dispatch.companyId, COMPANY_ID)),
    db.delete(die).where(eq(die.companyId, COMPANY_ID)),
    db.delete(customer).where(eq(customer.companyId, COMPANY_ID)),
    db.delete(auditLog).where(eq(auditLog.companyId, COMPANY_ID)),
    db
      .insert(company)
      .values({
        id: COMPANY_ID,
        name: "Fourcubes Extrusions (Demo)",
        slug: "orrn-demo",
        status: "active",
        plan: "dev",
        settings: { lengthUnit: "inch", timezone: "Asia/Kolkata" },
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
          settings: { lengthUnit: "inch", timezone: "Asia/Kolkata" },
          modules: ALL_MODULES,
        },
      }),
    db.delete(membership).where(eq(membership.companyId, COMPANY_ID)),
    db.insert(membership).values([
      { id: "dev-membership-owner", userId: ownerId, companyId: COMPANY_ID, role: "owner" as const },
      { id: "dev-membership-operator", userId: operatorId, companyId: COMPANY_ID, role: "operator" as const },
      { id: "dev-membership-viewer", userId: users.viewer.id, companyId: COMPANY_ID, role: "viewer" as const },
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
    ...insertChunks(db, bundleGroup, groups),
    ...insertChunks(db, bundle, bundleRows),
    ...insertChunks(db, bundleStatusEvent, eventRows),
    ...insertChunks(db, dispatch, dispatchRows),
    ...insertChunks(db, dispatchItem, itemRows),
  ];
  await atomicBatch(db, statements);

  // 4. Packing lists for completed dispatches, built by the router's own writer so the
  //    snapshot shape matches production. Then backdate them to the completion time.
  for (const plan of [c1, c2]) {
    const dispatchRow = await db.query.dispatch.findFirst({ where: eq(dispatch.id, plan.id) });
    if (!dispatchRow) throw new Error(`dev-seed: dispatch ${plan.id} missing after insert`);
    const { plId, statements: plStatements } = await packingListWriteBatch(db, {
      companyId: COMPANY_ID,
      dispatchRow,
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
      staff: DEV_ACCOUNTS.staff.email,
    },
    createdUsers,
    counts: {
      customers: customerRows.length,
      dies: dieRows.length,
      packingSessions: groups.length,
      bundles: bundleRows.length,
      dispatches: dispatchRows.length,
      packingLists: 2,
    },
    bundlesByStatus,
  };
  return result;
}
