/**
 * The open server items of portal fix round 2 (PORTAL-FIX2-OPEN.md), driven through the real ingest
 * procedures on real D1: X-new-2, X-new-5, M-new-4, B-new-2 and the checkers' minor points.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, ORDER_FIELDS, ORDER_HEADERS, plant, pump, rowsOf, upload } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

describe("X-new-2: rates left out stay left out through every re-read", () => {
  test("leave_out, then a cut length unit answer: the row is ready, no rate question, nothing open", async () => {
    const p = await plant(env, { priceOnSalesOrder: true });
    await p.owner.customer.create({ name: "Acme Traders" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    const headers = [...ORDER_HEADERS, "Rate (paise/kg)"];
    const fields = [...ORDER_FIELDS, { field: "rate", steps: [{ op: "number" as const, kind: "price_per_mass" as const, unit: "paise/kg" }] }];
    await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", headers, fields, ["customer", "poNumber", "orderDate"]), "Rated");
    const { candidates } = await upload(p.owner, [{ headers, rows: [["Acme Traders", "PO-1", "01/10/2025", "R", "5100", "12", "", "300", "250"]] }]);
    const id = candidates[0]!.id;
    await pump(p.admin, id);
    let c = await p.admin.ingest.candidate.get({ candidateId: id });
    c = await p.admin.ingest.answer.set({ candidateId: id, questionCode: "rates_hidden", subject: "", answer: "leave_out", expectSeq: c.serverSeq });
    await pump(p.admin, id);
    c = await p.admin.ingest.candidate.get({ candidateId: id });
    expect(c.questions.filter((q) => q.code === "magnitude_check" && q.open).map((q) => q.subject)).toEqual(["cutLength|mm|below"]);
    await p.admin.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "cutLength|mm|below", answer: "ft", expectSeq: c.serverSeq });
    await pump(p.admin, id);
    c = await p.admin.ingest.candidate.get({ candidateId: id });
    const [row] = await rowsOf(p.admin, id);
    expect(row!.state).toBe("ready_create");
    expect(row!.reasons?.some((r) => r.includes("rate"))).toBe(false);
    expect(c.questions.some((q) => q.code === "magnitude_check" && q.subject.startsWith("rate|"))).toBe(false);
    expect(c.openQuestions).toBe(0);
  });
});

describe("X-new-5: a stuck part of the derived new customers list has a way out", () => {
  test("check again opens its rows; the person skips one; approve and merge finish", async () => {
    const p = await plant(env);
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", ORDER_HEADERS, ORDER_FIELDS, ["customer", "poNumber", "orderDate"]), "Orders");
    const { candidates } = await upload(p.owner, [
      {
        headers: ORDER_HEADERS,
        rows: [
          ["Bharat Metals", "PO-1", "01/10/2025", "R", "5100", "3658", "", "300"],
          ["Zenith Traders", "PO-2", "01/10/2025", "R", "5100", "3658", "", "300"],
        ],
      },
    ]);
    const orders = candidates[0]!.id;
    await pump(p.owner, orders);
    let c = await p.owner.ingest.candidate.get({ candidateId: orders });
    await p.owner.ingest.answer.set({ candidateId: orders, questionCode: "new_customers", subject: "", answer: true, expectSeq: c.serverSeq });
    await pump(p.owner, orders);
    const child = await env.d1.prepare("select id from ingest_candidate where parent_id = ?").bind(orders).first<{ id: string }>();
    const list = child!.id;
    c = await p.owner.ingest.candidate.get({ candidateId: list });
    await p.owner.ingest.candidate.approve({ candidateId: list, expectSeq: c.serverSeq });
    const { runId } = await p.owner.ingest.merge.start();
    let cursor = 0;
    let step = await p.owner.ingest.merge.step({ runId, expectCursor: cursor });
    while (step.state === "planning") {
      cursor = step.cursor;
      step = await p.owner.ingest.merge.step({ runId, expectCursor: cursor });
    }
    cursor = step.cursor;
    // Every send ends the request before its result is recorded (a Worker past its CPU limit).
    const { ingestMergeChunk } = await import("@orrn/db/schema/ingest");
    const { eq } = await import("drizzle-orm");
    await env.db.update(ingestMergeChunk).set({ state: "sent", attempts: 3, sentAt: new Date(Date.now() - 120_000) }).where(eq(ingestMergeChunk.candidateId, list));
    for (let i = 0; i < 10 && (step.state === "running" || step.state === "planning"); i += 1) {
      step = await p.owner.ingest.merge.step({ runId, expectCursor: cursor });
      cursor = step.cursor;
    }
    c = await p.owner.ingest.candidate.get({ candidateId: list });
    expect(c.state).toBe("held");
    c = await p.owner.ingest.candidate.release({ candidateId: list, expectSeq: c.serverSeq });
    expect(c.state).toBe("ready");
    const rows = await rowsOf(p.owner, list);
    expect(rows.map((r) => r.mergeState)).toEqual(["open", "open"]);
    const zenith = rows.find((r) => (r.values as { name: string }).name === "Zenith Traders")!;
    await p.owner.ingest.rows.decide({ candidateId: list, rowIds: [zenith.id], decision: "skip", expectSeq: c.serverSeq });
    c = await p.owner.ingest.candidate.get({ candidateId: list });
    expect((await p.owner.ingest.candidate.approve({ candidateId: list, expectSeq: c.serverSeq })).state).toBe("approved");
    const again = await p.owner.ingest.merge.start();
    let cur2 = 0;
    let s2 = await p.owner.ingest.merge.step({ runId: again.runId, expectCursor: cur2 });
    for (let i = 0; i < 20 && (s2.state === "running" || s2.state === "planning"); i += 1) {
      cur2 = s2.cursor;
      s2 = await p.owner.ingest.merge.step({ runId: again.runId, expectCursor: cur2 });
    }
    expect(s2.state).toBe("done");
    const names = await env.d1.prepare("select name from customer where company_id = ? order by name").bind(p.companyId).all<{ name: string }>();
    expect(names.results.map((n) => n.name)).toEqual(["Bharat Metals"]);
  });
});

describe("minor 2: a stored 'owner merges' does not answer the rates question when pricing is off", () => {
  test("the question stays open and approve refuses", async () => {
    const p = await plant(env);
    await p.owner.customer.create({ name: "Acme Traders" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    const headers = [...ORDER_HEADERS, "Rate (paise/kg)"];
    const fields = [...ORDER_FIELDS, { field: "rate", steps: [{ op: "number" as const, kind: "price_per_mass" as const, unit: "paise/kg" }] }];
    await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", headers, fields, ["customer", "poNumber", "orderDate"]), "Rated");
    const { candidates } = await upload(p.owner, [{ headers, rows: [["Acme Traders", "PO-1", "01/10/2025", "R", "5100", "3658", "", "300", "25000"]] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    // Answered "owner merges" while rates were on; rates were turned off after.
    const { ingestAnswer } = await import("@orrn/db/schema/ingest");
    await env.db.insert(ingestAnswer).values({ id: `a_${id}`, companyId: p.companyId, candidateId: id, questionCode: "rates_hidden", subject: "", answer: "owner_merges", answeredBy: p.users.owner.id });
    const c = await p.owner.ingest.candidate.get({ candidateId: id });
    const q = c.questions.find((x) => x.code === "rates_hidden")!;
    expect(q.answer).toBe("owner_merges");
    expect(q.open).toBe(true);
    expect(c.openQuestions).toBeGreaterThan(0);
    await expect(p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).rejects.toThrow();
  });
});

describe("minor 3: a magnitude answer that names a unit already tried leaves the question open", () => {
  test("12 in mm, then cm (still too short), then mm again: the cm question stays open and approve refuses", async () => {
    const p = await plant(env);
    await p.owner.customer.create({ name: "Acme Traders" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", ORDER_HEADERS, ORDER_FIELDS, ["customer", "poNumber", "orderDate"]), "Orders");
    const { candidates } = await upload(p.owner, [{ headers: ORDER_HEADERS, rows: [["Acme Traders", "PO-1", "01/10/2025", "R", "5100", "12", "", "300"]] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.questions.filter((q) => q.code === "magnitude_check" && q.open).map((q) => q.subject)).toEqual(["cutLength|mm|below"]);
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "cutLength|mm|below", answer: "cm", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.questions.filter((q) => q.code === "magnitude_check" && q.open).map((q) => q.subject)).toEqual(["cutLength|cm|below"]);
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "cutLength|cm|below", answer: "mm", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    const q = c.questions.find((x) => x.code === "magnitude_check" && x.subject === "cutLength|cm|below")!;
    expect(q.answer).toBe("mm");
    expect(q.open).toBe(true);
    expect((await rowsOf(p.owner, id))[0]!.state).toBe("ambiguous");
    expect(c.openQuestions).toBeGreaterThan(0);
    await expect(p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).rejects.toThrow();
  });
});
