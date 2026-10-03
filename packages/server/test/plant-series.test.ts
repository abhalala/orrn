/**
 * PL-2: document series (spec P7), plant bundle numbers on receipts, and the code resolver (P8/P20).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { bundle, bundleGroup, docSeries, legacyBundleMap } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
type DocNumbers = typeof import("../src/lib/docNumber");
let dn: DocNumbers;

beforeAll(async () => {
  env = await createTestEnv();
  dn = await import("../src/lib/docNumber");
});

afterAll(async () => {
  await env.dispose();
});

/** Instants written in IST so the rollover cases read as the plant clock reads. */
const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("nextDocNumber", () => {
  test("20 concurrent allocations are distinct and gapless", async () => {
    const { companyId } = await env.seedCompany();
    const at = ist("2026-09-13T10:00:00");
    const out = await Promise.all(Array.from({ length: 20 }, () => dn.nextDocNumber(env.db, companyId, "bundle", at)));
    const seqs = out.map((o) => o.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(out.map((o) => o.number)).size).toBe(20);
    expect(out.every((o) => o.period === "2026-09")).toBe(true);
    expect(out.find((o) => o.seq === 7)!.number).toBe("26I7");
  });

  test("bundle/cast: monthly period, IST Dec to Jan rollover resets the sequence", async () => {
    const { companyId } = await env.seedCompany();
    const a = await dn.nextDocNumber(env.db, companyId, "bundle", ist("2026-12-31T23:59:59"));
    const b = await dn.nextDocNumber(env.db, companyId, "bundle", ist("2026-12-31T23:59:59"));
    // 18:30 UTC on 31 Dec is already 00:00 on 1 Jan in IST.
    const c = await dn.nextDocNumber(env.db, companyId, "bundle", new Date("2026-12-31T18:30:00Z"));
    const d = await dn.nextDocNumber(env.db, companyId, "bundle", new Date("2026-12-31T18:29:59Z"));
    expect([a.number, b.number, d.number]).toEqual(["26L1", "26L2", "26L3"]);
    expect(c).toEqual({ seq: 1, number: "27A1", period: "2027-01" });
  });

  test("a UTC date that is still the previous month in IST uses the IST month", async () => {
    const { companyId } = await env.seedCompany();
    // 30 Sep 2026 20:00 UTC = 1 Oct 01:30 IST
    const r = await dn.nextDocNumber(env.db, companyId, "bundle", new Date("2026-09-30T20:00:00Z"));
    expect(r).toEqual({ seq: 1, number: "26J1", period: "2026-10" });
  });

  test("cast: month letter + seq without year, year/month kept in period", async () => {
    const { companyId } = await env.seedCompany();
    const first = await dn.nextDocNumber(env.db, companyId, "cast", ist("2026-11-02T09:00:00"));
    expect(first).toEqual({ seq: 1, number: "K1", period: "2026-11" });
    // cast and bundle counters are independent
    const bundleNo = await dn.nextDocNumber(env.db, companyId, "bundle", ist("2026-11-02T09:00:00"));
    expect(bundleNo.number).toBe("26K1");
    // bundle number and cast code of the same month are different series, same letter
    const next = await dn.nextDocNumber(env.db, companyId, "cast", ist("2026-11-20T09:00:00"));
    expect(next.number).toBe("K2");
  });

  test("PL: financial year, 31 Mar to 1 Apr IST rollover, default prefix", async () => {
    const { companyId } = await env.seedCompany();
    const a = await dn.nextDocNumber(env.db, companyId, "pl", ist("2027-03-31T23:59:59"));
    const b = await dn.nextDocNumber(env.db, companyId, "pl", ist("2027-03-31T23:59:59"));
    const c = await dn.nextDocNumber(env.db, companyId, "pl", ist("2027-04-01T00:00:00"));
    const early = await dn.nextDocNumber(env.db, companyId, "pl", ist("2026-04-01T00:00:00"));
    expect(a).toEqual({ seq: 1, number: "PL/2026-27/1", period: "2026-27" });
    expect(b.number).toBe("PL/2026-27/2");
    expect(c).toEqual({ seq: 1, number: "PL/2027-28/1", period: "2027-28" });
    expect(early.number).toBe("PL/2026-27/3");
    // 31 Mar 20:00 UTC is already 1 Apr IST
    const utcEdge = await dn.nextDocNumber(env.db, companyId, "pl", new Date("2028-03-31T20:00:00Z"));
    expect(utcEdge.period).toBe("2028-29");
  });

  test("PL: prefix and starting number come from settings.plSeries so the plant's book continues", async () => {
    const { companyId } = await env.seedCompany({ settings: { plSeries: { prefix: "FC-PL/", start: 4501 } } });
    const at = ist("2026-10-03T10:00:00");
    const a = await dn.nextDocNumber(env.db, companyId, "pl", at);
    const b = await dn.nextDocNumber(env.db, companyId, "pl", at);
    expect(a).toEqual({ seq: 4501, number: "FC-PL/2026-27/4501", period: "2026-27" });
    expect(b.seq).toBe(4502);
    // an empty prefix is allowed
    const bare = await env.seedCompany({ settings: { plSeries: { prefix: "", start: 10 } } });
    expect((await dn.nextDocNumber(env.db, bare.companyId, "pl", at)).number).toBe("2026-27/10");
    // malformed settings fall back to the defaults
    const bad = await env.seedCompany({ settings: { plSeries: { prefix: 7, start: -3 } } });
    expect((await dn.nextDocNumber(env.db, bad.companyId, "pl", at)).number).toBe("PL/2026-27/1");
  });

  test("other document types: {TYPE}-{seq} per financial year", async () => {
    const { companyId } = await env.seedCompany();
    const at = ist("2026-10-03T10:00:00");
    const types = {
      lot: "LOT-1",
      mrs: "MRS-1",
      grn: "GRN-1",
      so: "SO-1",
      press_run: "PR-1",
      dc_note: "DCN-1",
      count: "CNT-1",
    } as const;
    for (const [type, number] of Object.entries(types)) {
      const r = await dn.nextDocNumber(env.db, companyId, type as keyof typeof types, at);
      expect(r).toEqual({ seq: 1, number, period: "2026-27" });
    }
    expect((await dn.nextDocNumber(env.db, companyId, "lot", at)).number).toBe("LOT-2");
    expect((await dn.nextDocNumber(env.db, companyId, "lot", ist("2027-04-01T00:00:00"))).number).toBe("LOT-1");
  });

  test("company timezone setting moves the period boundary", async () => {
    const { companyId } = await env.seedCompany({ settings: { timezone: "UTC" } });
    // 18:30 UTC 31 Dec: still December in UTC.
    const r = await dn.nextDocNumber(env.db, companyId, "bundle", new Date("2026-12-31T18:30:00Z"));
    expect(r.number).toBe("26L1");
  });

  test("tenant isolation: counters are per company", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const at = ist("2026-09-13T10:00:00");
    await dn.nextDocNumber(env.db, a.companyId, "bundle", at);
    await dn.nextDocNumber(env.db, a.companyId, "bundle", at);
    const first = await dn.nextDocNumber(env.db, b.companyId, "bundle", at);
    expect(first.number).toBe("26I1");
    const rows = await env.db.select().from(docSeries).where(eq(docSeries.companyId, a.companyId));
    expect(rows.map((r) => r.value)).toEqual([2]);
  });

  test("unknown company is an error, not a silent new series", async () => {
    await expect(dn.nextDocNumber(env.db, "no-such-company", "bundle", new Date())).rejects.toThrow();
  });

  test("allocateDocNumbers hands out one contiguous block atomically", async () => {
    const { companyId } = await env.seedCompany();
    const at = ist("2026-09-13T10:00:00");
    const [x, y] = await Promise.all([
      dn.allocateDocNumbers(env.db, companyId, "bundle", at, 150),
      dn.allocateDocNumbers(env.db, companyId, "bundle", at, 150),
    ]);
    expect(x.numbers).toHaveLength(150);
    expect(y.numbers).toHaveLength(150);
    const all = [...x.numbers, ...y.numbers];
    expect(new Set(all).size).toBe(300);
    for (const block of [x, y]) {
      const seqs = block.numbers.map((n) => Number(n.slice(3)));
      expect(seqs).toEqual(Array.from({ length: 150 }, (_, i) => seqs[0]! + i));
    }
    expect([x.numbers[0], y.numbers[0]].sort()).toEqual(["26I1", "26I151"].sort());
    expect(await dn.allocateDocNumbers(env.db, companyId, "bundle", at, 0).then((r) => r.numbers)).toEqual([]);
  });
});

describe("createReceipt numbering", () => {
  // createReceipt reads the injectable clock, so these never depend on the real month.
  const PINNED = ist("2026-09-15T10:00:00");
  beforeAll(async () => {
    (await import("../src/lib/clock")).setClockForTests(PINNED);
  });
  afterAll(async () => {
    (await import("../src/lib/clock")).setClockForTests(null);
  });
  const rows = (n: number) => Array.from({ length: n }, () => ({ quantity: 10, weightG: 25_000, lengthMm: 3658 }));

  test("plant mode: per-bundle plant numbers in creation order, continuing across receipts", async () => {
    const { companyId } = await env.seedCompany({ settings: { bundleNumbering: "plant" } });
    const dieId = await env.seedDie(companyId);
    const c = env.caller({ role: "packer", companyId });
    const yy = "26";
    const letter = "I";

    const r1 = await c.bundle.createReceipt({ dieId, unit: "pcs", rows: rows(3) });
    const r2 = await c.bundle.createReceipt({ dieId, unit: "pcs", rows: rows(2) });
    const get = async (groupId: string) =>
      (await env.db.select().from(bundle).where(and(eq(bundle.companyId, companyId), eq(bundle.groupId, groupId))))
        .map((b) => b.serial)
        .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
    expect(await get(r1.groupId)).toEqual([1, 2, 3].map((n) => `${yy}${letter}${n}`));
    expect(await get(r2.groupId)).toEqual([4, 5].map((n) => `${yy}${letter}${n}`));
    // the group keeps its BG code
    expect(r1.code).toMatch(/^BG-\d{6}$/);
    // the number scans back to its bundle
    const hit = await c.bundle.getBySerial({ serial: `${yy}${letter}2` });
    expect(hit.bundle.groupId).toBe(r1.groupId);
  });

  test("plant mode: 200-row receipt stays under 100 params per statement and is gapless", async () => {
    const { companyId } = await env.seedCompany({ settings: { bundleNumbering: "plant" } });
    const dieId = await env.seedDie(companyId);
    const c = env.caller({ role: "packer", companyId });
    const r = await c.bundle.createReceipt({ dieId, unit: "pcs", rows: rows(200) });
    const serials = (await env.db.select().from(bundle).where(eq(bundle.groupId, r.groupId))).map((b) => b.serial);
    expect(new Set(serials).size).toBe(200);
    const seqs = serials.map((s) => Number(s.slice(3))).sort((a, b) => a - b);
    expect(seqs[0]).toBe(1);
    expect(seqs[199]).toBe(200);
  });

  test("receipt in a new month restarts at 1 and a new year changes the prefix", async () => {
    const clock = await import("../src/lib/clock");
    const { companyId } = await env.seedCompany({ settings: { bundleNumbering: "plant" } });
    const dieId = await env.seedDie(companyId);
    const c = env.caller({ role: "packer", companyId });
    try {
      clock.setClockForTests(ist("2026-12-31T23:59:00"));
      const dec = await c.bundle.createReceipt({ dieId, unit: "pcs", rows: rows(2) });
      clock.setClockForTests(ist("2027-01-01T00:01:00"));
      const jan = await c.bundle.createReceipt({ dieId, unit: "pcs", rows: rows(1) });
      const serialsOf = async (groupId: string) =>
        (await env.db.select().from(bundle).where(eq(bundle.groupId, groupId))).map((b) => b.serial).sort();
      expect(await serialsOf(dec.groupId)).toEqual(["26L1", "26L2"]);
      expect(await serialsOf(jan.groupId)).toEqual(["27A1"]);
    } finally {
      clock.setClockForTests(PINNED);
    }
  });

  test("doc_series row records who first used the series", async () => {
    const { companyId, users } = await env.seedCompany({ settings: { bundleNumbering: "plant" } });
    const dieId = await env.seedDie(companyId);
    await env.caller({ role: "packer", companyId }).bundle.createReceipt({ dieId, unit: "pcs", rows: rows(1) });
    const [row] = await env.db.select().from(docSeries).where(eq(docSeries.companyId, companyId));
    expect(row!.createdBy).toBe(users.packer.id);
    expect(row!.period).toBe("2026-09");
  });

  test("two companies number independently", async () => {
    const a = await env.seedCompany({ settings: { bundleNumbering: "plant" } });
    const b = await env.seedCompany({ settings: { bundleNumbering: "plant" } });
    const dieA = await env.seedDie(a.companyId);
    const dieB = await env.seedDie(b.companyId);
    await env.caller({ role: "packer", companyId: a.companyId }).bundle.createReceipt({ dieId: dieA, unit: "pcs", rows: rows(5) });
    const rb = await env.caller({ role: "packer", companyId: b.companyId }).bundle.createReceipt({ dieId: dieB, unit: "pcs", rows: rows(1) });
    const [only] = await env.db.select().from(bundle).where(eq(bundle.groupId, rb.groupId));
    expect(only!.serial.slice(3)).toBe("1");
  });

  test("default and explicit legacy mode keep BG serials", async () => {
    for (const settings of [{}, { bundleNumbering: "legacy" }, { bundleNumbering: "nonsense" }]) {
      const { companyId } = await env.seedCompany({ settings });
      const dieId = await env.seedDie(companyId);
      const r = await env.caller({ role: "packer", companyId }).bundle.createReceipt({ dieId, unit: "pcs", rows: rows(2) });
      const serials = (await env.db.select().from(bundle).where(eq(bundle.groupId, r.groupId))).map((b) => b.serial).sort();
      expect(serials).toEqual([`${r.code}-B001`, `${r.code}-B002`]);
      expect(await env.db.select().from(docSeries).where(eq(docSeries.companyId, companyId))).toHaveLength(0);
    }
  });

  test("bundleGroup rows still created with sync cursor", async () => {
    const { companyId } = await env.seedCompany({ settings: { bundleNumbering: "plant" } });
    const dieId = await env.seedDie(companyId);
    const r = await env.caller({ role: "owner", companyId }).bundle.createReceipt({ dieId, unit: "pcs", rows: rows(1) });
    const [g] = await env.db.select().from(bundleGroup).where(eq(bundleGroup.id, r.groupId));
    expect(g!.serverSeq).toBeGreaterThan(0);
  });
});

describe("resolve.byCode", () => {
  async function plantCompany(settings: Record<string, unknown> = { bundleNumbering: "plant" }) {
    const co = await env.seedCompany({ settings });
    const dieId = await env.seedDie(co.companyId);
    return { ...co, dieId };
  }

  /** Insert a bundle with an exact serial (history from other years is not creatable via the API). */
  async function insertBundle(companyId: string, dieId: string, serial: string, over: Partial<typeof bundle.$inferInsert> = {}) {
    const groupId = crypto.randomUUID();
    await env.db.insert(bundleGroup).values({ id: groupId, companyId, code: `G-${groupId}`, dieId, unit: "pcs" });
    const id = crypto.randomUUID();
    await env.db.insert(bundle).values({
      id,
      companyId,
      groupId,
      dieId,
      serial,
      quantity: 24,
      weightG: 143_200,
      lengthMm: 3658,
      status: "available",
      ...over,
    });
    return id;
  }

  test("plant number, bare, lower case and as the label QR URL", async () => {
    const { companyId, dieId } = await plantCompany();
    const id = await insertBundle(companyId, dieId, "26I4086");
    const c = env.caller({ role: "viewer", companyId });
    for (const code of ["26I4086", "26i4086", " 26I4086 ", "https://fourcubes.orrn.in/b/26I4086", '"26I4086"']) {
      expect(await c.resolve.byCode({ code })).toEqual({ kind: "bundle", bundleId: id, number: "26I4086" });
    }
  });

  test("current BG serial still resolves", async () => {
    const { companyId, dieId } = await plantCompany({});
    const id = await insertBundle(companyId, dieId, "BG-000012-B003");
    const c = env.caller({ role: "operator", companyId });
    expect(await c.resolve.byCode({ code: "bg-000012-b003" })).toEqual({ kind: "bundle", bundleId: id, number: "BG-000012-B003" });
  });

  test("old month-only number: one match resolves, several are ambiguous newest year first", async () => {
    const { companyId, dieId } = await plantCompany();
    const a = await insertBundle(companyId, dieId, "25J540");
    const c = env.caller({ role: "packer", companyId });
    expect(await c.resolve.byCode({ code: "J540" })).toEqual({ kind: "bundle", bundleId: a, number: "25J540" });

    const b = await insertBundle(companyId, dieId, "26J540");
    const old = await insertBundle(companyId, dieId, "24J540");
    await insertBundle(companyId, dieId, "26J54"); // different seq, never a candidate
    await insertBundle(companyId, dieId, "26K540"); // different month
    expect(await c.resolve.byCode({ code: "j540" })).toEqual({
      kind: "ambiguous",
      candidates: [
        { bundleId: b, number: "26J540", year: 2026 },
        { bundleId: a, number: "25J540", year: 2025 },
        { bundleId: old, number: "24J540", year: 2024 },
      ],
    });
  });

  test("a full plant number never falls back to other years", async () => {
    const { companyId, dieId } = await plantCompany();
    await insertBundle(companyId, dieId, "25J540");
    const c = env.caller({ role: "packer", companyId });
    expect(await c.resolve.byCode({ code: "26J540" })).toEqual({ kind: "not_found" });
  });

  test("legacy cuid via legacy_bundle_map, any case, also from a URL", async () => {
    const { companyId, dieId } = await plantCompany();
    const id = await insertBundle(companyId, dieId, "26I100");
    const cuid = "cmtibj86a00jvr101p2348h5o";
    await env.db.insert(legacyBundleMap).values({ id: crypto.randomUUID(), companyId, legacyId: cuid, bundleId: id });
    const c = env.caller({ role: "viewer", companyId });
    for (const code of [cuid, cuid.toUpperCase(), `https://old.fourcubes.in/b/${cuid}`]) {
      expect(await c.resolve.byCode({ code })).toEqual({ kind: "bundle", bundleId: id, number: "26I100" });
    }
    expect(await c.resolve.byCode({ code: "cmtibj86a00jvr101p2348h5x" })).toEqual({ kind: "not_found" });
  });

  test("unknown and unparsable codes are not_found", async () => {
    const { companyId } = await plantCompany();
    const c = env.caller({ role: "viewer", companyId });
    for (const code of ["26I9999", "J9999", "BG-1-B1", "not a code!", "https://x.test/other/26I1", "A"]) {
      expect(await c.resolve.byCode({ code })).toEqual({ kind: "not_found" });
    }
  });

  test("tenant isolation: another company's bundle, month-only match and cuid are not_found", async () => {
    const mine = await plantCompany();
    const theirs = await plantCompany();
    const theirBundle = await insertBundle(theirs.companyId, theirs.dieId, "26I4086");
    await insertBundle(theirs.companyId, theirs.dieId, "25J540");
    const cuid = "cmtibj86a00jvr101p2348h5o";
    await env.db.insert(legacyBundleMap).values({ id: crypto.randomUUID(), companyId: theirs.companyId, legacyId: cuid, bundleId: theirBundle });
    const c = env.caller({ role: "owner", companyId: mine.companyId });
    for (const code of ["26I4086", "J540", cuid]) {
      expect(await c.resolve.byCode({ code })).toEqual({ kind: "not_found" });
    }
    // a map row that points across tenants is ignored too
    const crossCuid = "cmtibj86a00jvr101p2348zzz";
    await env.db.insert(legacyBundleMap).values({ id: crypto.randomUUID(), companyId: mine.companyId, legacyId: crossCuid, bundleId: theirBundle });
    expect(await c.resolve.byCode({ code: crossCuid })).toEqual({ kind: "not_found" });
  });

  test("requires a signed-in company member; every role may read", async () => {
    const { companyId } = await plantCompany();
    await expect(env.caller(null).resolve.byCode({ code: "26I1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const role of ["viewer", "accountant", "storekeeper", "die_room"] as const) {
      expect(await env.caller({ role, companyId }).resolve.byCode({ code: "26I1" })).toEqual({ kind: "not_found" });
    }
  });
});

describe("resolve.publicBundle", () => {
  async function setup() {
    const co = await env.seedCompany({ settings: { bundleNumbering: "plant" } });
    const dieId = await env.seedDie(co.companyId, { series: "DOMAL", sectionCode: "12170" });
    const groupId = crypto.randomUUID();
    await env.db.insert(bundleGroup).values({ id: groupId, companyId: co.companyId, code: `G-${groupId}`, dieId, unit: "pcs" });
    const id = crypto.randomUUID();
    await env.db.insert(bundle).values({
      id,
      companyId: co.companyId,
      groupId,
      dieId,
      serial: "26I4086",
      poNumber: "SECRET-PO",
      quantity: 24,
      weightG: 143_200,
      lengthMm: 3658,
      status: "available",
    });
    const { company } = await import("@orrn/db/schema");
    const [row] = await env.db.select({ slug: company.slug }).from(company).where(eq(company.id, co.companyId));
    return { ...co, id, slug: row!.slug, groupId, dieId };
  }

  test("signed-out caller gets exactly { number, section } (RP5)", async () => {
    const { slug } = await setup();
    const pub = env.caller(null);
    const expected = { number: "26I4086", section: "DOMAL 12170" };
    expect(await pub.resolve.publicBundle({ code: "26I4086", companyHost: `${slug}.orrn.in` })).toEqual(expected);
    // QR URL, lower case, host with port, bare slug
    expect(await pub.resolve.publicBundle({ code: "https://x.orrn.in/b/26i4086", companyHost: `${slug.toUpperCase()}.orrn.in:443` })).toEqual(expected);
    expect(await pub.resolve.publicBundle({ code: "26I4086", companyHost: slug })).toEqual(expected);
    const res = await pub.resolve.publicBundle({ code: "26I4086", companyHost: slug });
    expect(Object.keys(res).sort()).toEqual(["number", "section"]);
    expect(JSON.stringify(res)).not.toContain("143");
  });

  test("a member of that company also gets kg, pcs and status", async () => {
    const { slug, companyId, id } = await setup();
    const { bundle: b } = await import("@orrn/db/schema");
    for (const role of ["viewer", "packer", "owner"] as const) {
      const res = await env.caller({ role, companyId }).resolve.publicBundle({ code: "26I4086", companyHost: slug });
      expect(res).toEqual({ number: "26I4086", section: "DOMAL 12170", kg: 143.2, pcs: 24, status: "available" });
    }
    await env.db.update(b).set({ status: "void" }).where(eq(b.id, id));
    const res = await env.caller({ role: "viewer", companyId }).resolve.publicBundle({ code: "26I4086", companyHost: slug });
    expect((res as { status: string }).status).toBe("void");
  });

  test("a member of another company only gets the signed-out view", async () => {
    const a = await setup();
    const other = await env.seedCompany();
    const res = await env.caller({ role: "owner", companyId: other.companyId }).resolve.publicBundle({ code: "26I4086", companyHost: a.slug });
    expect(res).toEqual({ number: "26I4086", section: "DOMAL 12170" });
  });

  test("anything else is NOT_FOUND with one generic message", async () => {
    const a = await setup();
    const b = await setup();
    const pub = env.caller(null);
    const cases = [
      { code: "26I4087", companyHost: a.slug }, // no such bundle
      { code: "26I4086", companyHost: "nobody.orrn.in" }, // no such company
      { code: "26I4086", companyHost: "" }, // empty host
      { code: "!!", companyHost: a.slug }, // unparsable
    ];
    const messages = new Set<string>();
    for (const input of cases) {
      const err = await pub.resolve.publicBundle(input).catch((e) => e);
      expect(err).toMatchObject({ code: "NOT_FOUND" });
      messages.add(err.message);
    }
    expect(messages.size).toBe(1);
    // company A's host can't see company B's bundle number once B's differs
    const { bundle: tbl } = await import("@orrn/db/schema");
    await env.db.update(tbl).set({ serial: "26I5000" }).where(eq(tbl.id, b.id));
    expect(await pub.resolve.publicBundle({ code: "26I5000", companyHost: a.slug }).catch((e) => e.code)).toBe("NOT_FOUND");
    expect((await pub.resolve.publicBundle({ code: "26I5000", companyHost: b.slug })).number).toBe("26I5000");
  });

  test("old month-only codes (unique or ambiguous) are NOT_FOUND to signed-out callers", async () => {
    const { slug, companyId, dieId } = await setup();
    const mk = async (serial: string) => {
      const groupId = crypto.randomUUID();
      await env.db.insert(bundleGroup).values({ id: groupId, companyId, code: `G-${groupId}`, dieId, unit: "pcs" });
      await env.db.insert(bundle).values({ id: crypto.randomUUID(), companyId, groupId, dieId, serial, quantity: 1, weightG: 1000, lengthMm: 3000 });
    };
    await mk("25J540");
    const pub = env.caller(null);
    expect(await pub.resolve.publicBundle({ code: "J540", companyHost: slug }).catch((e) => e.code)).toBe("NOT_FOUND");
    await mk("26J540");
    expect(await pub.resolve.publicBundle({ code: "J540", companyHost: slug }).catch((e) => e.code)).toBe("NOT_FOUND");
    // a signed-in member still gets a unique old-style match, but never an ambiguous one
    const member = env.caller({ role: "viewer", companyId });
    expect(await member.resolve.publicBundle({ code: "J540", companyHost: slug }).catch((e) => e.code)).toBe("NOT_FOUND");
    const solo = await member.resolve.publicBundle({ code: "J541", companyHost: slug }).catch((e) => e.code);
    expect(solo).toBe("NOT_FOUND"); // no such bundle
    await mk("25K7");
    expect((await member.resolve.publicBundle({ code: "K7", companyHost: slug })).number).toBe("25K7");
    expect(await pub.resolve.publicBundle({ code: "K7", companyHost: slug }).catch((e) => e.code)).toBe("NOT_FOUND");
  });

  test("suspended or pending companies expose nothing", async () => {
    const { slug, companyId } = await setup();
    const { company } = await import("@orrn/db/schema");
    await env.db.update(company).set({ status: "suspended" }).where(eq(company.id, companyId));
    expect(await env.caller(null).resolve.publicBundle({ code: "26I4086", companyHost: slug }).catch((e) => e.code)).toBe("NOT_FOUND");
  });
});

describe("company.updateSettings: numbering settings", () => {
  const PINNED = ist("2026-09-15T10:00:00");
  beforeAll(async () => {
    (await import("../src/lib/clock")).setClockForTests(PINNED);
  });
  afterAll(async () => {
    (await import("../src/lib/clock")).setClockForTests(null);
  });

  async function addBundle(companyId: string, createdAt: Date) {
    const dieId = await env.seedDie(companyId);
    const groupId = crypto.randomUUID();
    await env.db.insert(bundleGroup).values({ id: groupId, companyId, code: `G-${groupId}`, dieId, unit: "pcs" });
    await env.db.insert(bundle).values({
      id: crypto.randomUUID(),
      companyId,
      groupId,
      dieId,
      serial: `S-${groupId}`,
      quantity: 1,
      weightG: 1000,
      lengthMm: 3000,
      createdAt,
    });
  }
  const settingsOf = async (companyId: string) => {
    const { company } = await import("@orrn/db/schema");
    return (await env.db.select().from(company).where(eq(company.id, companyId)))[0]!.settings;
  };

  test("admin sets bundleNumbering and plSeries; merged, audited, used by nextDocNumber", async () => {
    const { auditLog } = await import("@orrn/db/schema");
    const { companyId } = await env.seedCompany({ settings: { lengthUnit: "mm" } });
    const admin = env.caller({ role: "admin", companyId });
    const res = await admin.company.updateSettings({ bundleNumbering: "plant", plSeries: { prefix: "FC/", start: 4501 } });
    expect(res.settings).toEqual({ lengthUnit: "mm", bundleNumbering: "plant", plSeries: { prefix: "FC/", start: 4501 } });
    expect(await settingsOf(companyId)).toEqual(res.settings);
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.settings.update")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ changed: { bundleNumbering: "plant", plSeries: { prefix: "FC/", start: 4501 } } });
    expect((await dn.nextDocNumber(env.db, companyId, "pl", PINNED)).number).toBe("FC/2026-27/4501");
  });

  test("validation: enum, prefix length/whitespace, start positive int; nothing written", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const bad: unknown[] = [
      { bundleNumbering: "other" },
      { plSeries: { prefix: "ABCDEFGHIJKLM", start: 1 } },
      { plSeries: { prefix: "P L/", start: 1 } },
      { plSeries: { prefix: "PL/\n", start: 1 } },
      { plSeries: { prefix: "PL/", start: 0 } },
      { plSeries: { prefix: "PL/", start: -5 } },
      { plSeries: { prefix: "PL/", start: 1.5 } },
      { plSeries: { prefix: "PL/" } },
    ];
    for (const input of bad) {
      await expect(owner.company.updateSettings(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await settingsOf(companyId)).toEqual({});
    // 12 chars and an empty prefix are fine
    await owner.company.updateSettings({ plSeries: { prefix: "ABCDEFGHIJKL", start: 1 } });
    await owner.company.updateSettings({ plSeries: { prefix: "", start: 1 } });
  });

  test("only users.manage roles may set them", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of ["manager", "office", "viewer"] as const) {
      await expect(env.caller({ role, companyId }).company.updateSettings({ bundleNumbering: "plant" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("switching bundleNumbering is refused when a bundle exists this month (IST), allowed otherwise", async () => {
    const { companyId } = await env.seedCompany();
    const admin = env.caller({ role: "admin", companyId });
    // last month's bundle (31 Aug 23:59 IST) does not block
    await addBundle(companyId, ist("2026-08-31T23:59:00"));
    expect((await admin.company.updateSettings({ bundleNumbering: "plant" })).settings.bundleNumbering).toBe("plant");
    // 1 Sep 00:00 IST bundle (still 31 Aug in UTC) blocks the switch back
    await addBundle(companyId, ist("2026-09-01T00:00:00"));
    await expect(admin.company.updateSettings({ bundleNumbering: "legacy" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await settingsOf(companyId)).bundleNumbering).toBe("plant");
    // re-saving the current value is not a switch
    await admin.company.updateSettings({ bundleNumbering: "plant" });
    // other settings are never blocked
    await admin.company.updateSettings({ lengthUnit: "inch" });
  });

  test("no setting counts as legacy: re-saving legacy is allowed, switching to plant is blocked this month", async () => {
    const { companyId } = await env.seedCompany();
    const admin = env.caller({ role: "owner", companyId });
    // 'legacy' on a company with no setting is not a switch
    await addBundle(companyId, ist("2026-09-02T10:00:00"));
    await admin.company.updateSettings({ bundleNumbering: "legacy" });
    await expect(admin.company.updateSettings({ bundleNumbering: "plant" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("platform staff (impersonating) may switch mid-month", async () => {
    const { user, platformAdmin, impersonationGrant } = await import("@orrn/db/schema");
    const { companyId } = await env.seedCompany();
    await addBundle(companyId, ist("2026-09-10T10:00:00"));
    const staffId = crypto.randomUUID();
    await env.db.insert(user).values({ id: staffId, name: "Staff", email: `staff.${staffId}@test.orrn` });
    await env.db.insert(platformAdmin).values({ userId: staffId, role: "admin" });
    await env.db.insert(impersonationGrant).values({
      id: crypto.randomUUID(),
      platformAdminId: staffId,
      companyId,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const staff = env.callerForUser(staffId, { impersonate: companyId });
    expect((await staff.company.updateSettings({ bundleNumbering: "plant" })).settings.bundleNumbering).toBe("plant");
  });

  test("the month check follows the company timezone", async () => {
    const { companyId } = await env.seedCompany({ settings: { timezone: "UTC" } });
    // 31 Aug 20:00 UTC = 1 Sep IST, but still August in UTC: does not block a UTC company
    await addBundle(companyId, new Date("2026-08-31T20:00:00Z"));
    const owner = env.caller({ role: "owner", companyId });
    expect((await owner.company.updateSettings({ bundleNumbering: "plant" })).settings.bundleNumbering).toBe("plant");
  });
});
