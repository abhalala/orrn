/**
 * orrn buddy, a 4,000-row order book with many per-order questions (lead decision 7, review S6). Real D1, through
 * `/mcp` and `buddy.drafts.*`, with the real 20 drafts an hour limit on.
 *
 * The sheet has 150 old orders that each carry two different POs, so the dry run asks 150 distinct `order_po`
 * questions. The buddy answers them in drafts of up to ANSWERS_PER_DRAFT (30), all made in one turn on one candidate
 * (the delta S3 chain), and the sheet reaches the review link with 2 dry run drafts + 5 answers drafts = 7 drafts.
 * The ceiling at 30 answers a draft: (20 - 2) x 30 = 540 questions within the hour.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { buddyDraft } from "@orrn/db/schema";
import { fingerprint, type Recipe } from "@orrn/ingest";
import { eq, sql } from "drizzle-orm";

import { listPlant, tool } from "./buddy-fixture";
import { draft, drive, learnRecipe, uploadSheet } from "./buddy-import-fixture";
import { createTestEnv, type TestEnv } from "./harness";
import { plant as ingestPlant } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
const SECTIONS = ["5100", "5101", "5102"];

function bookLayout(): Recipe {
  const fp = fingerprint({ headers: BOOK, rows: [] });
  const trim = [{ op: "trim" as const }];
  const fields: { field: string; steps: Recipe["fields"][number]["steps"] }[] = [
    { field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
    { field: "oldOrderNo", steps: trim },
    { field: "poNumber", steps: trim },
    { field: "orderDate", steps: [{ op: "date", format: "dmy" }] },
    { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
    { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
    { field: "cutLength", steps: [{ op: "number", kind: "length", unit: "mm" }] },
    { field: "bakiKg", steps: [{ op: "number", kind: "mass", unit: "kg" }] },
  ];
  return {
    schemaVersion: 1,
    target: "orders",
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: fp.headerKey, headers: fp.normalized },
    fields: fields.map((f, i) => ({ field: f.field, source: { kind: "columns" as const, cols: [{ col: i, header: BOOK[i]! }] }, steps: f.steps })),
    filters: [],
    keys: ["customer", "oldOrderNo", "orderDate"],
    onExisting: "ask",
    unclear: [],
  } as Recipe;
}

/**
 * 4,000 rows: orders 1..150 have two rows each with two different POs (one question each); the other 3,700 rows are
 * 370 orders of 10 lines with one PO. Every line of an order has its own cut length.
 */
function bookRows(): string[][] {
  const rows: string[][] = [];
  for (let o = 1; o <= 150; o += 1) {
    rows.push(["Synthetic Traders", String(o), `PO-${o}-A`, "31/10/2025", "R", SECTIONS[o % 3]!, "3000", "300"]);
    rows.push(["Synthetic Traders", String(o), `PO-${o}-B`, "31/10/2025", "R", SECTIONS[(o + 1) % 3]!, "3001", "200"]);
  }
  for (let o = 151; o <= 520; o += 1) {
    for (let l = 0; l < 10; l += 1) rows.push(["Synthetic Traders", String(o), `PO-${o}`, "31/10/2025", "R", SECTIONS[l % 3]!, String(3000 + l), "100"]);
  }
  return rows;
}

describe("a 4,000-row order book with 150 PO questions reaches the review link within 20 drafts (review S6)", () => {
  test("dry run, 150 answers in 5 drafts made in one turn, dry run, review link", async () => {
    const p = await ingestPlant(env);
    await p.owner.customer.create({ name: "Synthetic Traders" });
    for (const code of SECTIONS) await env.seedDie(p.companyId, { series: "R", sectionCode: code });
    await learnRecipe(env, p, bookLayout(), "Order book");
    await listPlant(env, p.companyId);
    const { token } = await p.owner.buddy.grant.create();
    const rows = bookRows();
    expect(rows).toHaveLength(4000);
    const { candidateId } = await uploadSheet(p.owner, BOOK, rows, "synthetic-orders.xlsx", "Orders");

    const run1 = await draft(env, token, "orrn_import_dry_run", { candidateId });
    expect((await p.owner.buddy.drafts.confirm({ draftId: run1, via: "bubble" })).status).toBe("confirmed");
    await drive(p, run1);

    // The whole candidate is cut at 32 KB (the first run of this test saw 66 of the 150 questions that way), so the
    // buddy pages the open questions with orrn_import_questions.
    const whole = await tool(env, token, "orrn_call", { path: "ingest.candidate.get", input: { candidateId } });
    expect(whole).toMatchObject({ status: "ok", truncated: true });
    type Q = { code: string; subject: string; params: { pos?: string } };
    const open: Q[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await tool(env, token, "orrn_import_questions", { candidateId, ...(cursor ? { cursor } : {}) });
      expect(page.status).toBe("ok");
      expect(page.truncated).toBeUndefined();
      expect(page.data.total).toBe(150);
      open.push(...(page.data.questions as Q[]));
      cursor = page.data.next as string | null;
      pages += 1;
    } while (cursor && pages < 20);
    expect(pages).toBeGreaterThan(1);
    expect(open.filter((q) => q.code === "order_po")).toHaveLength(150);
    expect(new Set(open.map((q) => q.subject)).size).toBe(150);

    // One turn: Hermes drafts every batch before the person confirms any (the S3 chain on one candidate).
    const { ANSWERS_PER_DRAFT } = await import("../src/lib/buddy/importDrafts");
    const batches: string[] = [];
    for (let i = 0; i < open.length; i += ANSWERS_PER_DRAFT) {
      const answers = open.slice(i, i + ANSWERS_PER_DRAFT).map((q) => ({ questionCode: q.code, subject: q.subject, answer: { po: q.params!.pos!.split(", ")[0]! } }));
      batches.push(await draft(env, token, "orrn_import_answers", { candidateId, answers }));
    }
    expect(batches).toHaveLength(5);
    for (const id of batches) {
      const card = (await p.owner.buddy.drafts.listMine()).find((d) => d.id === id)!;
      expect(card.items!.length).toBeLessThanOrEqual(200);
      const out = await p.owner.buddy.drafts.confirm({ draftId: id, via: "bubble" });
      expect({ id, status: out.status, failure: out.failure }).toEqual({ id, status: "confirmed", failure: null });
    }

    const run2 = await draft(env, token, "orrn_import_dry_run", { candidateId });
    expect((await p.owner.buddy.drafts.confirm({ draftId: run2, via: "bubble" })).status).toBe("confirmed");
    await drive(p, run2);

    const ready = await p.owner.ingest.candidate.get({ candidateId });
    expect(ready).toMatchObject({ state: "ready", openQuestions: 0 });
    const link = await tool(env, token, "orrn_review_link", { candidateId });
    expect(link).toMatchObject({ status: "ok", data: { path: `/ingest/review/${candidateId}` } });

    const made = await env.db.select({ n: sql<number>`count(*)` }).from(buddyDraft).where(eq(buddyDraft.companyId, p.companyId)).get();
    expect(Number(made?.n)).toBe(7);
    expect(Number(made?.n)).toBeLessThanOrEqual(20);
  }, 240_000);
});
