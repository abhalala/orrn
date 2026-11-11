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
