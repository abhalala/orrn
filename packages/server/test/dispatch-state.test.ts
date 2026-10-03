import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { bundle, dispatch, dispatchItem } from "@orrn/db/schema";
import { and, eq, isNotNull, ne, or } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function setup(bundleCount: number) {
  const { companyId } = await env.seedCompany();
  const api = env.caller({ role: "owner", companyId });
  const dieId = await env.seedDie(companyId);
  const customerId = await env.seedCustomer(companyId);
  const bundles = await env.seedBundles(companyId, dieId, bundleCount);
  return { companyId, api, dieId, customerId, bundles };
}

async function bundleRow(id: string) {
  const [row] = await env.db.select().from(bundle).where(eq(bundle.id, id));
  return row!;
}

async function dispatchRow(id: string) {
  const [row] = await env.db.select().from(dispatch).where(eq(dispatch.id, id));
  return row!;
}

async function itemCount(dispatchId: string) {
  const rows = await env.db.select().from(dispatchItem).where(eq(dispatchItem.dispatchId, dispatchId));
  return rows.length;
}

describe("dispatch and bundle state predicates", () => {
  test("addBundle of a bundle held by another dispatch is refused with its code", async () => {
    const { api, customerId, bundles } = await setup(2);
    const a = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: a.id, bundleId: bundles[0]!.id });
    await api.dispatch.reserve({ id: a.id });

    const b = await api.dispatch.create({ customerId });
    await expect(api.dispatch.addBundle({ id: b.id, bundleId: bundles[0]!.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `Bundle is held by ${a.code}`,
    });
    expect(await itemCount(b.id)).toBe(0);
  });

  test("removeBundle from dispatch B does not free dispatch A's reservation", async () => {
    const { companyId, api, customerId, bundles } = await setup(2);
    const [x, y] = bundles;
    const a = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: a.id, bundleId: x!.id });
    await api.dispatch.reserve({ id: a.id });

    const b = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: b.id, bundleId: y!.id });
    await api.dispatch.reserve({ id: b.id });
    // Simulate the residual concurrent-add race (audit S6): B also lists X.
    await env.db.insert(dispatchItem).values({
      id: crypto.randomUUID(),
      companyId,
      dispatchId: b.id,
      bundleId: x!.id,
    });

    await api.dispatch.removeBundle({ id: b.id, bundleId: x!.id });

    const row = await bundleRow(x!.id);
    expect(row.status).toBe("reserved");
    expect(row.currentDispatchId).toBe(a.id);
    expect(await itemCount(b.id)).toBe(1);
  });

  for (const held of [false, true]) {
    const label = held ? "held" : "draft";

    test(`rescanning an already-added bundle on a ${label} dispatch is calm (addBundle)`, async () => {
      const { api, customerId, bundles } = await setup(1);
      const d = await api.dispatch.create({ customerId });
      await api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id });
      if (held) await api.dispatch.reserve({ id: d.id });

      const res = await api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id });
      expect(res).toMatchObject({ added: [], alreadyInDispatch: [bundles[0]!.serial] });
      expect(await itemCount(d.id)).toBe(1);
      const row = await bundleRow(bundles[0]!.id);
      expect(row.status).toBe(held ? "reserved" : "available");
    });

    test(`rescanning an already-added bundle on a ${label} dispatch is calm (addBundlesBySerial)`, async () => {
      const { api, customerId, bundles } = await setup(1);
      const d = await api.dispatch.create({ customerId });
      await api.dispatch.addBundlesBySerial({ id: d.id, serials: [bundles[0]!.serial] });
      if (held) await api.dispatch.reserve({ id: d.id });

      const res = await api.dispatch.addBundlesBySerial({ id: d.id, serials: [bundles[0]!.serial] });
      expect(res).toEqual({ added: [], alreadyInDispatch: [bundles[0]!.serial], notFound: [], unavailable: [] });
      expect(await itemCount(d.id)).toBe(1);
    });
  }

  test("two concurrent scans of the same bundle add it once and neither errors", async () => {
    const { api, customerId, bundles } = await setup(2);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: bundles[1]!.id });
    await api.dispatch.reserve({ id: d.id });

    const serial = bundles[0]!.serial;
    const results = await Promise.all([
      api.dispatch.addBundlesBySerial({ id: d.id, serials: [serial] }),
      api.dispatch.addBundlesBySerial({ id: d.id, serials: [serial] }),
      api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id }),
    ]);
    expect(results.flatMap((r) => r.added)).toEqual([serial]);
    expect(results.flatMap((r) => r.alreadyInDispatch)).toEqual([serial, serial]);
    expect(await itemCount(d.id)).toBe(2);
    expect((await bundleRow(bundles[0]!.id)).currentDispatchId).toBe(d.id);
  });

  test("addBundlesBySerial reports per serial and adds the valid ones", async () => {
    const { api, customerId, bundles } = await setup(6);
    const [fresh, quoted, already, heldElsewhere, voided, lower] = bundles;

    const other = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: other.id, bundleId: heldElsewhere!.id });
    await api.dispatch.reserve({ id: other.id });
    await api.bundle.transitionStatus({ id: voided!.id, toStatus: "void" });

    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: already!.id });
    await api.dispatch.reserve({ id: d.id });

    const res = await api.dispatch.addBundlesBySerial({
      id: d.id,
      serials: [
        fresh!.serial,
        `"${quoted!.serial}"`,
        ` ${already!.serial} `,
        "NOPE-0001",
        heldElsewhere!.serial,
        voided!.serial,
        lower!.serial.toLowerCase(),
        fresh!.serial, // duplicate in the same paste
      ],
    });

    expect(res).toEqual({
      added: [fresh!.serial, quoted!.serial, lower!.serial],
      alreadyInDispatch: [already!.serial],
      notFound: ["NOPE-0001"],
      unavailable: [
        // Structured reasons (T22): the UI words them in the reader's language; `reason` stays for old clients.
        { serial: heldElsewhere!.serial, reason: `Bundle is held by ${other.code}`, code: "held", status: "reserved", heldBy: other.code },
        { serial: voided!.serial, reason: "Bundle is void", code: "void", status: "void", heldBy: null },
      ],
    });
    expect(await itemCount(d.id)).toBe(4);
    for (const b of [fresh, quoted, lower]) {
      const row = await bundleRow(b!.id);
      expect(row.status).toBe("reserved");
      expect(row.currentDispatchId).toBe(d.id);
    }
    expect((await bundleRow(heldElsewhere!.id)).currentDispatchId).toBe(other.id);
    expect((await bundleRow(voided!.id)).status).toBe("void");
  });

  test("addBundlesBySerial reports a dispatched bundle with a structured reason", async () => {
    const { api, customerId, bundles } = await setup(2);
    const [shipped, other] = bundles;
    const done = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: done.id, bundleId: shipped!.id });
    await api.dispatch.reserve({ id: done.id });
    await api.dispatch.complete({ id: done.id });

    const d = await api.dispatch.create({ customerId });
    const res = await api.dispatch.addBundlesBySerial({ id: d.id, serials: [shipped!.serial, other!.serial] });
    expect(res.added).toEqual([other!.serial]);
    expect(res.unavailable).toEqual([
      { serial: shipped!.serial, reason: "Bundle is already dispatched", code: "dispatched", status: "dispatched", heldBy: null },
    ]);
  });

  test("getDispatch names each item's die (the floor knows sections by name)", async () => {
    const { companyId } = await env.seedCompany();
    const api = env.caller({ role: "owner", companyId });
    const dieId = await env.seedDie(companyId, { name: 'Patti 1" x 1/8"' });
    const customerId = await env.seedCustomer(companyId);
    const [b] = await env.seedBundles(companyId, dieId, 1);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: b!.id });
    const res = await api.dispatch.getDispatch({ id: d.id });
    expect(res.items[0]).toMatchObject({ serial: b!.serial, dieName: 'Patti 1" x 1/8"' });
  });

  test("addBundlesBySerial with nothing addable writes nothing and does not throw", async () => {
    const { api, customerId } = await setup(0);
    const d = await api.dispatch.create({ customerId });
    const before = await dispatchRow(d.id);
    const res = await api.dispatch.addBundlesBySerial({ id: d.id, serials: ["MISSING-1"] });
    expect(res).toEqual({ added: [], alreadyInDispatch: [], notFound: ["MISSING-1"], unavailable: [] });
    expect((await dispatchRow(d.id)).serverSeq).toBe(before.serverSeq);
  });

  test("complete after cancel is refused", async () => {
    const { api, customerId, bundles } = await setup(1);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id });
    await api.dispatch.reserve({ id: d.id });
    await api.dispatch.cancel({ id: d.id });

    await expect(api.dispatch.complete({ id: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await dispatchRow(d.id)).status).toBe("cancelled");
    expect((await bundleRow(bundles[0]!.id)).status).toBe("available");
  });

  test("cancel after complete is refused", async () => {
    const { api, customerId, bundles } = await setup(1);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id });
    await api.dispatch.reserve({ id: d.id });
    await api.dispatch.complete({ id: d.id });

    await expect(api.dispatch.cancel({ id: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await dispatchRow(d.id)).status).toBe("completed");
    expect((await bundleRow(bundles[0]!.id)).status).toBe("dispatched");
  });

  test("softDelete of a held dispatch asks to release the stock first", async () => {
    const { api, customerId, bundles } = await setup(1);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id });
    await api.dispatch.reserve({ id: d.id });

    await expect(api.dispatch.softDelete({ id: d.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Release the held stock first",
    });
    expect((await dispatchRow(d.id)).deletedAt).toBeNull();
  });

  test("transitionStatus void of a reserved bundle is refused", async () => {
    const { api, customerId, bundles } = await setup(1);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id });
    await api.dispatch.reserve({ id: d.id });

    await expect(api.bundle.transitionStatus({ id: bundles[0]!.id, toStatus: "void" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `Bundle is held by ${d.code}`,
    });
    const row = await bundleRow(bundles[0]!.id);
    expect(row.status).toBe("reserved");
    expect(row.currentDispatchId).toBe(d.id);
  });

  test("dispatch.update can clear notes with null", async () => {
    const { api, customerId } = await setup(0);
    const d = await api.dispatch.create({ customerId, notes: "call before delivery" });
    await api.dispatch.update({ id: d.id, notes: null });
    expect((await dispatchRow(d.id)).notes).toBeNull();
  });

  test("dispatch.update leaves notes alone when omitted", async () => {
    const { api, customerId } = await setup(0);
    const d = await api.dispatch.create({ customerId, notes: "keep me" });
    await api.dispatch.update({ id: d.id, shipDate: null });
    expect((await dispatchRow(d.id)).notes).toBe("keep me");
  });

  test("setItemGroupLabel on a bundle not in the dispatch is NOT_FOUND", async () => {
    const { api, customerId, bundles } = await setup(2);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id });

    await expect(
      api.dispatch.setItemGroupLabel({ id: d.id, bundleId: bundles[1]!.id, groupLabel: "A" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await api.dispatch.setItemGroupLabel({ id: d.id, bundleId: bundles[0]!.id, groupLabel: "a" });
    const [item] = await env.db
      .select()
      .from(dispatchItem)
      .where(and(eq(dispatchItem.dispatchId, d.id), eq(dispatchItem.bundleId, bundles[0]!.id)));
    expect(item!.groupLabel).toBe("A");
  });
});

/**
 * Race orderings (audit S6). `beforeNextBatch` runs the other mutation after the
 * first procedure's reads and right before its atomic write, so each ordering is
 * deterministic. The invariant: no bundle is left reserved against a dispatch
 * that is not live and reserved.
 */
describe("race orderings never strand a reserved bundle", () => {
  async function orphanHolds(companyId: string) {
    return env.db
      .select({ serial: bundle.serial, dispatchStatus: dispatch.status })
      .from(bundle)
      .innerJoin(dispatch, eq(dispatch.id, bundle.currentDispatchId))
      .where(
        and(
          eq(bundle.companyId, companyId),
          eq(bundle.status, "reserved"),
          or(ne(dispatch.status, "reserved"), isNotNull(dispatch.deletedAt)),
        ),
      );
  }

  async function heldDispatch(n = 2) {
    const fx = await setup(n);
    const d = await fx.api.dispatch.create({ customerId: fx.customerId });
    await fx.api.dispatch.addBundle({ id: d.id, bundleId: fx.bundles[0]!.id });
    await fx.api.dispatch.reserve({ id: d.id });
    return { ...fx, d };
  }

  test("add to held dispatch reads, cancel lands, add writes", async () => {
    const { companyId, api, bundles, d } = await heldDispatch();
    env.beforeNextBatch(() => api.dispatch.cancel({ id: d.id }));
    await api.dispatch.addBundlesBySerial({ id: d.id, serials: [bundles[1]!.serial] });

    expect((await dispatchRow(d.id)).status).toBe("cancelled");
    expect((await bundleRow(bundles[1]!.id)).status).toBe("available");
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("single addBundle reads, cancel lands, add writes", async () => {
    const { companyId, api, bundles, d } = await heldDispatch();
    env.beforeNextBatch(() => api.dispatch.cancel({ id: d.id }));
    await api.dispatch.addBundle({ id: d.id, bundleId: bundles[1]!.id });

    expect((await bundleRow(bundles[1]!.id)).status).toBe("available");
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("cancel reads, add to held dispatch lands, cancel writes", async () => {
    const { companyId, api, bundles, d } = await heldDispatch();
    env.beforeNextBatch(() => api.dispatch.addBundlesBySerial({ id: d.id, serials: [bundles[1]!.serial] }));
    await api.dispatch.cancel({ id: d.id });

    expect((await dispatchRow(d.id)).status).toBe("cancelled");
    for (const b of bundles) {
      const row = await bundleRow(b.id);
      expect(row.status).toBe("available");
      expect(row.currentDispatchId).toBeNull();
    }
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("add to held dispatch reads, unreserve lands, add writes", async () => {
    const { companyId, api, bundles, d } = await heldDispatch();
    env.beforeNextBatch(() => api.dispatch.unreserve({ id: d.id }));
    const res = await api.dispatch.addBundlesBySerial({ id: d.id, serials: [bundles[1]!.serial] });

    expect(res.added).toEqual([bundles[1]!.serial]);
    expect((await dispatchRow(d.id)).status).toBe("draft");
    expect((await bundleRow(bundles[1]!.id)).status).toBe("available");
    expect(await itemCount(d.id)).toBe(2);
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("unreserve reads, add to held dispatch lands, unreserve writes", async () => {
    const { companyId, api, bundles, d } = await heldDispatch();
    env.beforeNextBatch(() => api.dispatch.addBundlesBySerial({ id: d.id, serials: [bundles[1]!.serial] }));
    await api.dispatch.unreserve({ id: d.id });

    expect((await dispatchRow(d.id)).status).toBe("draft");
    for (const b of bundles) expect((await bundleRow(b.id)).status).toBe("available");
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("reserve reads, softDelete lands, reserve writes", async () => {
    const { companyId, api, customerId, bundles } = await setup(2);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundlesBySerial({ id: d.id, serials: bundles.map((b) => b.serial) });
    env.beforeNextBatch(() => api.dispatch.softDelete({ id: d.id }));
    await api.dispatch.reserve({ id: d.id });

    const row = await dispatchRow(d.id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.status).toBe("draft");
    for (const b of bundles) expect((await bundleRow(b.id)).status).toBe("available");
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("reserve reads, cancel lands, reserve writes", async () => {
    const { companyId, api, customerId, bundles } = await setup(2);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundlesBySerial({ id: d.id, serials: bundles.map((b) => b.serial) });
    env.beforeNextBatch(() => api.dispatch.cancel({ id: d.id }));
    await api.dispatch.reserve({ id: d.id });

    expect((await dispatchRow(d.id)).status).toBe("cancelled");
    for (const b of bundles) expect((await bundleRow(b.id)).status).toBe("available");
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("cancel of a draft reads, reserve lands, cancel writes", async () => {
    const { companyId, api, customerId, bundles } = await setup(2);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundlesBySerial({ id: d.id, serials: bundles.map((b) => b.serial) });
    env.beforeNextBatch(() => api.dispatch.reserve({ id: d.id }));
    await api.dispatch.cancel({ id: d.id });

    expect((await dispatchRow(d.id)).status).toBe("cancelled");
    for (const b of bundles) expect((await bundleRow(b.id)).status).toBe("available");
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("softDelete of a draft reads, reserve lands, softDelete writes", async () => {
    const { companyId, api, customerId, bundles } = await setup(1);
    const d = await api.dispatch.create({ customerId });
    await api.dispatch.addBundle({ id: d.id, bundleId: bundles[0]!.id });
    env.beforeNextBatch(() => api.dispatch.reserve({ id: d.id }));
    await api.dispatch.softDelete({ id: d.id });

    const row = await dispatchRow(d.id);
    expect(row.deletedAt).toBeNull();
    expect(row.status).toBe("reserved");
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("complete reads, add to held dispatch lands, complete writes", async () => {
    const { companyId, api, bundles, d } = await heldDispatch();
    env.beforeNextBatch(() => api.dispatch.addBundlesBySerial({ id: d.id, serials: [bundles[1]!.serial] }));
    await api.dispatch.complete({ id: d.id });

    expect((await dispatchRow(d.id)).status).toBe("completed");
    expect((await bundleRow(bundles[0]!.id)).status).toBe("dispatched");
    const straggler = await bundleRow(bundles[1]!.id);
    expect(straggler.status).toBe("available");
    expect(straggler.currentDispatchId).toBeNull();
    // The straggler is not left listed on the completed dispatch either.
    expect(await itemCount(d.id)).toBe(1);
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("void reads, add to held dispatch lands, void writes", async () => {
    const { companyId, api, bundles, d } = await heldDispatch();
    env.beforeNextBatch(() => api.dispatch.addBundle({ id: d.id, bundleId: bundles[1]!.id }));
    await api.bundle.transitionStatus({ id: bundles[1]!.id, toStatus: "void" });

    const row = await bundleRow(bundles[1]!.id);
    expect(row.status).toBe("reserved");
    expect(row.currentDispatchId).toBe(d.id);
    expect(await orphanHolds(companyId)).toEqual([]);
  });

  test("a dispatch whose hold was partly lost can still be released", async () => {
    const { companyId, api, bundles, d } = await heldDispatch();
    // Bundle listed on d but never reserved to it (lost reserve race).
    await env.db.insert(dispatchItem).values({
      id: crypto.randomUUID(),
      companyId,
      dispatchId: d.id,
      bundleId: bundles[1]!.id,
    });
    await api.dispatch.unreserve({ id: d.id });
    expect((await dispatchRow(d.id)).status).toBe("draft");
    expect((await bundleRow(bundles[0]!.id)).status).toBe("available");
    expect(await orphanHolds(companyId)).toEqual([]);
  });
});
