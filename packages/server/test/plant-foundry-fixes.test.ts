/**
 * PL-5 review round 1 (coord/reviews/PL5-*-r0.md): behaviour fixes, each test written to fail
 * before its fix.
 *
 * - Demo seed reset knows the foundry tables (spec I-1): a melt against a demo lot no longer
 *   breaks `/dev/seed`, and a reseed restarts the cast series without a UNIQUE collision.
 * - Bori vs melts (correctness I-1): a pending bori deduction is held back from the lot's
 *   remaining kg, a bori note is refused when the foundry already melted the kg, and the
 *   `dc_note` approval refuses a deduction that would drive the lot below zero.
 * - Melt cancel vs cast close (correctness I-2): the cancel bumps the cast row, the close guards
 *   on it, so a close never lands on figures that include a melt cancelled in the same instant.
 * - Cheap minors: output streams re-checked at write time, retired DROSS / FE say "reactivate",
 *   melt times not long before the cast opened, list tie-break, lot readers pinned.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { approval, cast, dcNote, melt, returnStream, stockLedger } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: (at: Date | null) => void;

setDefaultTimeout(60_000);

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
});
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

const KG = 1000;
const U = 1000;
const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 9, 3, 2, 0, 0);
const NOW = new Date(T0 + 10 * H);

function times(t0 = T0) {
  return { preheatStart: t0, chargingStart: t0 + H, chargingEnd: t0 + 3 * H, castingStart: t0 + 4 * H, castingEnd: t0 + 6 * H };
}

async function plant() {
  setClock(NOW);
  const { companyId, users } = await env.seedCompany();
  const callers = Object.fromEntries(ROLES.map((role) => [role, env.caller({ role, companyId })])) as Record<
    CompanyRole,
    ReturnType<typeof env.caller>
  >;
  await callers.owner.stock.locations.seedDefaults();
  await callers.manager.purchase.seedScrapDefaults();
  await callers.manager.foundry.returnStreams.seedDefaults();
  const items = (await callers.manager.purchase.scrapItems.list()).items;
  const v = await callers.manager.vendor.create({ name: "Shree Ganesh Metals" });
  const streams = (await callers.viewer.foundry.returnStreams.list()).items;
  const stream = (code: string) => streams.find((s) => s.code === code)!.id;
  return {
    companyId,
    users,
    ...callers,
    vendorId: v.id,
    itemId: items.find((i) => i.name === "IMP BELLING")!.id,
    stream,
  };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function okLot(p: Plant, kg: number) {
  const lot = await p.storekeeper.purchase.lots.create({
    vendorId: p.vendorId,
    date: "2026-10-01",
    origin: "LOCAL",
    itemId: p.itemId,
    grade: "A",
    partyKgG: kg * KG,
    fcKgG: kg * KG,
    ratePaise: 18_500,
    billBook: "main",
  });
  await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
  return lot;
}

async function openCast(p: Plant) {
  return p.foundry.foundry.casts.open({ alloy: "6063" });
}

type MeltInput = Parameters<Plant["foundry"]["foundry"]["melts"]["create"]>[0];

/** One lot line in, logs only out. */
function simpleMelt(castId: string, lotId: string, inKg: number, logsKg: number, over: Partial<MeltInput> = {}): MeltInput {
  return {
    castId,
    timestamps: times(),
    ldoTenthIn: { start: 480, end: 455 },
    inputs: [{ kind: "lot", ref: lotId, kgG: inKg * KG }],
    chemicals: [],
    outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: logsKg * KG }, drossG: 0, feG: 0, returns: [] },
    ...over,
  };
}

const sum = (rows: { qtyG: number }[]) => rows.reduce((s, r) => s + r.qtyG, 0);

async function scrapSum(companyId: string) {
  const rows = await env.db.select().from(stockLedger).where(eq(stockLedger.companyId, companyId));
  return sum(rows.filter((r) => r.itemKind === "scrap_grade"));
}
async function remainingOf(p: Plant, lotId: string) {
  const { lots } = await p.foundry.foundry.lots.available();
  return lots.find((l) => l.id === lotId)?.remainingG ?? 0;
}
async function castRow(id: string) {
  return (await env.db.select().from(cast).where(eq(cast.id, id)))[0]!;
}
async function castCloseApprovals(companyId: string) {
  return env.db.select().from(approval).where(and(eq(approval.companyId, companyId), eq(approval.kind, "cast_close")));
}
async function notesOf(companyId: string) {
  return env.db.select().from(dcNote).where(eq(dcNote.companyId, companyId));
}
async function dcNoteLedger(companyId: string) {
  const rows = await env.db.select().from(stockLedger).where(eq(stockLedger.companyId, companyId));
  return rows.filter((r) => r.voucherType === "dc_note");
}

// ---------------------------------------------------------------------------
// Demo seed (spec review I-1)
// ---------------------------------------------------------------------------

describe("dev seed: the reset knows the foundry tables", () => {
  test("a melt (with a store chemical and a spectro result) against a demo lot does not break a reseed; the cast series restarts cleanly", async () => {
    const { user } = await import("@orrn/db/schema");
    for (const key of ["owner", "operator", "viewer", "office", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
    }
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    const owner = env.caller({ role: "owner", companyId });
    const lot = (await owner.foundry.lots.available()).lots[0]!;
    expect(lot.remainingG).toBeGreaterThan(1_000 * KG);
    const first = await owner.foundry.casts.open({ alloy: "6063" });
    const flux = await owner.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
    await owner.store.receive({ itemId: flux.id, qtyMilli: 50 * U });
    const t0 = Date.now() - 8 * H;
    const m = await owner.foundry.melts.create({
      ...simpleMelt(first.id, lot.id, 1_000, 970),
      timestamps: times(t0),
      inputs: [
        { kind: "lot", ref: lot.id, kgG: 1_000 * KG },
        { kind: "return_stream", ref: (await owner.foundry.returnStreams.list()).items.find((s) => s.code === "INGOT")!.id, kgG: 100 * KG },
      ],
      chemicals: [{ storeItemId: flux.id, openMilli: 10 * U, usedMilli: 4 * U, closeMilli: 6 * U }],
      outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 1_040 * KG }, drossG: 30 * KG, feG: 0, returns: [] },
    });
    await owner.foundry.spectro.attach({ meltId: m.id, fileName: "spectro.csv", mime: "text/csv", base64: "", values: { Si: 0.45 } });

    // The reset must delete the foundry rows before the lots, locations and store items they point at.
    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    // Only the seed's own cast (W2-PR-S press demo, billets on hand) comes back; the app-made one is gone.
    expect((await env.db.select({ id: cast.id }).from(cast).where(eq(cast.companyId, companyId))).map((c) => c.id)).toEqual(["dev-cast-1"]);
    expect(await env.db.select().from(melt).where(eq(melt.companyId, companyId))).toEqual([]);
    // Wave 2 contracts: the seed puts back the foundry sheet's 11 streams (fresh rows, none the app made).
    const streams = await env.db.select().from(returnStream).where(eq(returnStream.companyId, companyId));
    expect(streams.map((r) => r.code).sort()).toEqual(
      ["BEND-LOG", "DISCARD", "DROSS", "DROSS-INGOT", "DROSS-METAL", "FE", "HILL-METAL", "INGOT", "PIT-METAL", "PLANT-SCRAP", "TENDIS"],
    );
    expect(streams.every((r) => r.createdBy === "dev-user-owner")).toBe(true);
    // doc_series restarted, and so did the casts: the same number again, no UNIQUE collision.
    const again = await owner.foundry.casts.open({ alloy: "6063" });
    expect(again.number).toBe(first.number);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// Bori deductions vs melt draws (correctness review I-1)
// ---------------------------------------------------------------------------

describe("a bori deduction can never take a lot below what the foundry melted", () => {
  test("[S1] the foundry melted the whole lot: a bori note is refused, saying so; nothing is written and scrap stays at 0", async () => {
    const p = await plant();
    const lot = await okLot(p, 10_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 10_000, 9_750));
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 200 * KG }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("melted") });
    expect(await notesOf(p.companyId)).toEqual([]);
    expect(await scrapSum(p.companyId)).toBe(0);
    // the money side can still go on a note without bori
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "grade", kgDiffG: 0, boriDeductionG: 0, amountPaise: 50_000 }),
    ).resolves.toMatchObject({ number: expect.stringMatching(/^DCN-/) });
  });

  test("a bori note may take only what is left: 9,900 kg melted leaves room for 100 kg, not 101", async () => {
    const p = await plant();
    const lot = await okLot(p, 10_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 9_900, 9_650));
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 101 * KG }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("100") });
    const note = await p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 100 * KG });
    await p.manager.approval.decide({ id: note.approvalId, decision: "approved" });
    expect(await scrapSum(p.companyId)).toBe(0);
    expect((await p.foundry.foundry.lots.available()).lots.find((l) => l.id === lot.id)).toBeUndefined();
  });

  test("a pending bori is held back from the lot: the foundry cannot melt it, and approving it lands at exactly 0", async () => {
    const p = await plant();
    const lot = await okLot(p, 10_000);
    const note = await p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 200 * KG });
    const listed = (await p.foundry.foundry.lots.available()).lots.find((l) => l.id === lot.id)!;
    expect(listed).toMatchObject({ stockG: 9_800 * KG, drawnG: 0, remainingG: 9_800 * KG });
    const c = await openCast(p);
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 9_900, 9_650))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("9,800"),
    });
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 9_800, 9_550));
    await p.manager.approval.decide({ id: note.approvalId, decision: "approved" });
    expect(await scrapSum(p.companyId)).toBe(0);
    expect(await remainingOf(p, lot.id)).toBe(0);
  });

  test("a rejected bori note frees its kg for the foundry again", async () => {
    const p = await plant();
    const lot = await okLot(p, 10_000);
    const note = await p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 200 * KG });
    expect(await remainingOf(p, lot.id)).toBe(9_800 * KG);
    await p.manager.approval.decide({ id: note.approvalId, decision: "rejected" });
    expect(await remainingOf(p, lot.id)).toBe(10_000 * KG);
  });

  test("RACE: a melt lands after the bori note read the lot — the note does not land and says the foundry melted it", async () => {
    const p = await plant();
    const lot = await okLot(p, 10_000);
    const c = await openCast(p);
    env.beforeNextBatch(() => p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 9_900, 9_650)));
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 200 * KG }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("melted") });
    expect(await notesOf(p.companyId)).toEqual([]);
    expect(await scrapSum(p.companyId)).toBe(100 * KG);
  });

  test("RACE: a bori note lands after the melt read the lot — the melt does not draw the held-back kg", async () => {
    const p = await plant();
    const lot = await okLot(p, 10_000);
    const c = await openCast(p);
    env.beforeNextBatch(() =>
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 200 * KG }),
    );
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 9_900, 9_650))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("9,800"),
    });
    expect(await env.db.select().from(melt).where(eq(melt.companyId, p.companyId))).toEqual([]);
  });

  test("the dc_note approval refuses a deduction that would take the lot below zero (data from before the guard)", async () => {
    const p = await plant();
    const lot = await okLot(p, 10_000);
    const note = await p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 100 * KG });
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 9_900, 9_650));
    // A note whose bori grew outside the guards (e.g. raised before this rule existed).
    await env.db.update(dcNote).set({ boriDeductionG: 300 * KG }).where(eq(dcNote.id, note.id));
    await expect(p.manager.approval.decide({ id: note.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("melted"),
    });
    expect((await env.db.select().from(approval).where(eq(approval.id, note.approvalId)))[0]!.status).toBe("pending");
    expect((await notesOf(p.companyId))[0]!.status).toBe("pending");
    expect(await dcNoteLedger(p.companyId)).toEqual([]);
    expect(await scrapSum(p.companyId)).toBe(100 * KG);
    // rejecting it is always possible
    await p.manager.approval.decide({ id: note.approvalId, decision: "rejected" });
    expect((await notesOf(p.companyId))[0]!.status).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// Melt cancel racing the cast close (correctness review I-2)
// ---------------------------------------------------------------------------

describe("a melt cancel that lands between the close read and its batch makes the close refuse", () => {
  test("[S3] reason path: the 6 % melt is cancelled mid-close — no closing, no approval for a tail that no longer exists", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 11_000, 10_700)); // 2.7 %: no tail
    const bad = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 10_000, 9_400)); // 6 %: 300 kg tail
    expect((await p.viewer.foundry.casts.get({ id: c.id })).closeout).toMatchObject({ tailG: 300 * KG, needsReason: true });
    env.beforeNextBatch(() => p.foundry.foundry.melts.cancel({ meltId: bad.id, reason: "Entered on the wrong cast" }));
    await expect(p.supervisor.foundry.casts.close({ castId: c.id, tailReason: "Pit metal" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("changed"),
    });
    expect(await castRow(c.id)).toMatchObject({ status: "open", tailG: null, closeSummary: null, closeApprovalId: null });
    expect(await castCloseApprovals(p.companyId)).toEqual([]);
    // asked again, it closes on the live figures without a reason
    expect(await p.supervisor.foundry.casts.close({ castId: c.id })).toMatchObject({ status: "closed", tailG: 0 });
  });

  test("[S2] no-reason path: a second normal melt is cancelled mid-close — the close does not freeze the stale input", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 11_000, 10_700));
    const second = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 11_000, 10_700));
    env.beforeNextBatch(() => p.foundry.foundry.melts.cancel({ meltId: second.id, reason: "Typed twice" }));
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await castRow(c.id)).status).toBe("open");
    await p.supervisor.foundry.casts.close({ castId: c.id });
    expect((await castRow(c.id)).closeSummary).toMatchObject({ inputG: 11_000 * KG });
  });

  test("reason path: billets leave after the close read the tail — the close does not freeze the old tail into an approval", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 10_000, 9_400)); // 300 kg tail
    const billetStore = (await p.owner.stock.locations.list()).items.find((l) => l.code === "BILLET")!.id;
    // a press run stand-in: 500 kg of the cast's billets leave the billet store
    env.beforeNextBatch(() =>
      env.db.insert(stockLedger).values({
        id: crypto.randomUUID(), companyId: p.companyId, serverSeq: 0, voucherType: "move", voucherId: crypto.randomUUID(),
        line: 1, itemKind: "billet", itemRef: c.id, locationId: billetStore, qtyG: -500 * KG, postedAt: new Date(),
      }),
    );
    await expect(p.supervisor.foundry.casts.close({ castId: c.id, tailReason: "Pit metal" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("changed"),
    });
    expect((await castRow(c.id)).status).toBe("open");
    expect(await castCloseApprovals(p.companyId)).toEqual([]);
  });

  test("a melt cancel moves the cast's server_seq (sync clients see the cast changed)", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, 1_000, 970));
    const before = (await castRow(c.id)).serverSeq;
    await p.foundry.foundry.melts.cancel({ meltId: m.id, reason: "x" });
    const after = await castRow(c.id);
    expect(after.serverSeq).toBeGreaterThan(before);
    expect(after.meltCount).toBe(1); // the next melt still gets number 2
  });
});

// ---------------------------------------------------------------------------
// Minor findings
// ---------------------------------------------------------------------------

describe("output streams are re-checked at write time; retired DROSS / FE say reactivate", () => {
  test("RACE: DROSS is retired after the melt read it — the melt does not land and says so", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    env.beforeNextBatch(() => p.manager.foundry.returnStreams.update({ id: p.stream("DROSS"), active: false }));
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, 1_000, 950, { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 950 * KG }, drossG: 20 * KG, feG: 0, returns: [] } }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Dross") });
    expect(await env.db.select().from(melt).where(eq(melt.companyId, p.companyId))).toEqual([]);
  });

  test("RACE: a returned-metal stream is retired after the melt read it — the melt does not land", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    env.beforeNextBatch(() => p.manager.foundry.returnStreams.update({ id: p.stream("INGOT"), active: false }));
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, 1_000, 950, {
          outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 950 * KG }, drossG: 0, feG: 0, returns: [{ streamId: p.stream("INGOT"), kgG: 20 * KG }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Ingot") });
    expect(await env.db.select().from(melt).where(eq(melt.companyId, p.companyId))).toEqual([]);
  });

  test("a retired DROSS / FE stream asks to reactivate it; a DROSS code that is not a by-product is refused", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.manager.foundry.returnStreams.update({ id: p.stream("FE"), active: false });
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, 1_000, 950, { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 950 * KG }, drossG: 0, feG: 20 * KG, returns: [] } }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/Fe.*reactivate/) });
    // a stream coded DROSS that someone made a charge stream never receives dross
    await env.db.update(returnStream).set({ kind: "charge" }).where(eq(returnStream.id, p.stream("DROSS")));
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, 1_000, 950, { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 950 * KG }, drossG: 20 * KG, feG: 0, returns: [] } }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("by-product") });
    expect(await env.db.select().from(melt).where(eq(melt.companyId, p.companyId))).toEqual([]);
  });
});

describe("melt times sit near their cast", () => {
  test("a preheat start more than 7 days before the cast opened is a typing slip; 6 days is fine", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p); // opened at NOW
    await expect(
      p.foundry.foundry.melts.create({ ...simpleMelt(c.id, lot.id, 1_000, 970), timestamps: times(NOW.getTime() - 8 * DAY) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("before") });
    await expect(
      p.foundry.foundry.melts.create({ ...simpleMelt(c.id, lot.id, 1_000, 970), timestamps: times(NOW.getTime() - 6 * DAY) }),
    ).resolves.toMatchObject({ seq: 1 });
  });
});

describe("list order and readers", () => {
  test("casts opened at the same instant list by number, newest first", async () => {
    const p = await plant();
    for (let i = 0; i < 3; i += 1) await openCast(p); // pinned clock: one opened_at
    expect((await p.viewer.foundry.casts.list({})).items.map((x) => x.number)).toEqual(["J3", "J2", "J1"]);
  });

  test("lots.available readers are pinned: purchase, report and foundry roles read; press, packer and die room do not", async () => {
    const p = await plant();
    const readers: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "foundry", "storekeeper", "operator", "viewer"];
    for (const role of ROLES) {
      if (readers.includes(role)) await expect(p[role].foundry.lots.available()).resolves.toBeDefined();
      else await expect(p[role].foundry.lots.available()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("returnStreams.update with another plant's stream id is NOT_FOUND and changes nothing", async () => {
    const p = await plant();
    const q = await plant();
    await expect(q.manager.foundry.returnStreams.update({ id: p.stream("INGOT"), active: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await env.db.select().from(returnStream).where(eq(returnStream.id, p.stream("INGOT"))))[0]!.active).toBe(true);
  });
});
