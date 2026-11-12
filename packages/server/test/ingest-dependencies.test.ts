/**
 * Things that depend on each other in one upload (PORTAL-RULES-3 section 2, X-new-4): the result
 * never depends on which dry run finishes first. Real D1 through the `ingest` router.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { approve, countOf, DIE_HEADERS, dieLayout, learnLayout, mergeOnce, ORDER_HEADERS, orderLayout, plant, pump, rowsOf, upload } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const BOOK_ROWS = [
  ["Acme Traders", "PO-1", "01/10/2025", "R", "9100", "3658", "", "300"],
  ["Acme Traders", "PO-1", "01/10/2025", "R", "9100", "4877", "", "200"],
];

async function setup(dieRows: string[][] = [["R", "9100", "2.0", "2.4"]]) {
  const p = await plant(env);
  await p.owner.customer.create({ name: "Acme Traders" });
  await learnLayout(env, p.companyId, p.users.owner.id, dieLayout(), "Dies");
  await learnLayout(env, p.companyId, p.users.owner.id, orderLayout(), "Orders");
  const { candidates } = await upload(p.owner, [
    { name: "Dies", headers: DIE_HEADERS, rows: dieRows },
    { name: "Order book", headers: ORDER_HEADERS, rows: BOOK_ROWS },
  ]);
  return { p, dies: candidates[0]!.id, orders: candidates[1]!.id };
}

describe("X-new-4: the order book's dry run may finish before the die sheet's", () => {
  test("the order book goes back to checking from its first refused row when the die sheet is ready; approve both, one merge writes both lines", async () => {
    const { p, dies, orders } = await setup();
    await pump(p.owner, orders);
    expect((await rowsOf(p.owner, orders)).map((r) => r.reasons)).toEqual([["section_unknown:sectionCode"], ["section_unknown:sectionCode"]]);
    await pump(p.owner, dies);
    const c = await p.owner.ingest.candidate.get({ candidateId: orders });
    expect(c.state).toBe("processing");
    expect(c.dryCursor).toBe(0);
    await pump(p.owner, orders);
    expect((await rowsOf(p.owner, orders)).map((r) => [r.state, r.reasons])).toEqual([
      ["ready_create", ["section_pending:sectionCode"]],
      ["ready_create", ["section_pending:sectionCode"]],
    ]);
    expect((await approve(p.owner, dies)).state).toBe("approved");
    expect((await approve(p.owner, orders)).state).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await countOf(env, "sales_order_line", p.companyId)).toBe(2);
  });

  test("approve refuses a sheet whose refusals are stale ('Check this sheet again'); check again on a ready sheet runs it", async () => {
    const { p, orders } = await setup();
    await pump(p.owner, orders);
    // The section is added on the dies screen after the order book was checked.
    await env.seedDie(p.companyId, { series: "R", sectionCode: "9100" });
    await expect(approve(p.owner, orders)).rejects.toThrow("Check this sheet again");
    const c = await p.owner.ingest.candidate.get({ candidateId: orders });
    expect((await p.owner.ingest.candidate.release({ candidateId: orders, expectSeq: c.serverSeq })).state).toBe("processing");
    await pump(p.owner, orders);
    expect((await rowsOf(p.owner, orders)).map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
    expect((await approve(p.owner, orders)).state).toBe("approved");
  });

  test("two pending die rows for one section count as one", async () => {
    const p = await plant(env);
    await p.owner.customer.create({ name: "Acme Traders" });
    await learnLayout(env, p.companyId, p.users.owner.id, dieLayout(), "Dies");
    await learnLayout(env, p.companyId, p.users.owner.id, orderLayout(), "Orders");
    const one = await upload(p.owner, [{ name: "Dies", headers: DIE_HEADERS, rows: [["R", "9100", "2.0", "2.4"]] }], "dies-a.xlsx");
    const two = await upload(p.owner, [{ name: "Dies", headers: DIE_HEADERS, rows: [["R", "9100", "2.0", "2.4"]] }], "dies-b.xlsx");
    await pump(p.owner, one.candidates[0]!.id);
    await pump(p.owner, two.candidates[0]!.id);
    const book = await upload(p.owner, [{ name: "Order book", headers: ORDER_HEADERS, rows: BOOK_ROWS }], "book.xlsx");
    await pump(p.owner, book.candidates[0]!.id);
    expect((await rowsOf(p.owner, book.candidates[0]!.id)).map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
  });
});
