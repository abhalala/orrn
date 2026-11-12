/**
 * Rule 7.5 (PORTAL-RULES-3, round 6): the built-in bundle layout fits the web's old template, which
 * has no old bundle number column. Such bundles may be imported after one question on the sheet:
 * "These bundles have no old bundle number. If the same bundles are in another file, orrn cannot tell
 * and would add them twice. Import them?", answered "Import them" (true) or "Do not import" (false).
 * The same file is still never imported twice.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { mergeOnce, plant, pump, rowsOf, sha, upload, type Caller } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

// The web's old bundle template (mm), as packages/ingest builtins/web-templates.fixture.ts holds it.
const OLD_TEMPLATE = ["Die series", "Section code", "Pieces", "Weight (kg)", "Length (mm)", "PO number"];
const ROWS = [
  ["40", "4012", "25", "58.4", "3658", "PO-2611"],
  ["40", "4012", "20", "44.9", "3505", ""],
];

const seqOf = async (as: Caller, candidateId: string) => (await as.ingest.candidate.get({ candidateId })).serverSeq;

async function bundles(companyId: string): Promise<number> {
  const r = await env.d1.prepare("select count(*) as n from bundle where company_id = ?").bind(companyId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

async function setup() {
  const p = await plant(env);
  await env.seedDie(p.companyId, { series: "40", sectionCode: "4012" });
  return p;
}

async function answer(as: Caller, candidateId: string, value: boolean) {
  await as.ingest.answer.set({ candidateId, questionCode: "bundles_no_old_id", subject: "", answer: value, expectSeq: await seqOf(as, candidateId) });
  await pump(as, candidateId);
}

describe("rule 7.5: bundles with no old bundle number", () => {
  test("the old template's rows wait on one question; after Import them they import, and the same file opens the first", async () => {
    const p = await setup();
    const h = sha();
    const first = await upload(p.owner, [{ name: "Bundles", headers: OLD_TEMPLATE, rows: ROWS }], "bundles.xlsx", h);
    const id = first.candidates[0]!.id;
    expect(first.candidates[0]!.target).toBe("bundles");
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ambiguous", "ambiguous"]);
    const q = (await p.owner.ingest.candidate.get({ candidateId: id })).questions.find((x) => x.code === "bundles_no_old_id");
    expect(q).toMatchObject({ open: true, params: { count: 2 } });
    await expect(p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: await seqOf(p.owner, id) })).rejects.toThrow("Answer every question first");
    await answer(p.owner, id, true);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
    await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: await seqOf(p.owner, id) });
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await bundles(p.companyId)).toBe(2);
    // The same bytes again: the first artifact, already imported; nothing is added.
    const again = await p.owner.ingest.artifact.begin({ sha256: h, fileName: "bundles.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
    expect(again).toMatchObject({ artifactId: first.artifactId, existing: true });
    expect(await bundles(p.companyId)).toBe(2);
  });

  test("Do not import writes nothing: the rows are left out and the sheet has nothing to import", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ name: "Bundles", headers: OLD_TEMPLATE, rows: ROWS }], "bundles.xlsx");
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    await answer(p.owner, id, false);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["skipped", "skipped"]);
    expect(rows[0]!.reasons).toContain("no_old_id_not_imported:legacyId");
    await expect(p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: await seqOf(p.owner, id) })).rejects.toThrow(
      "Nothing in this sheet can be imported. Fix the rows or discard it.",
    );
    expect(await bundles(p.companyId)).toBe(0);
  });

  test("bundles with an old bundle number are not asked about", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ name: "Bundles", headers: ["Legacy id", ...OLD_TEMPLATE], rows: ROWS.map((r, i) => [`B-${i + 1}`, ...r]) }], "with-ids.xlsx");
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
    expect((await p.owner.ingest.candidate.get({ candidateId: id })).questions.some((x) => x.code === "bundles_no_old_id")).toBe(false);
  });
});
