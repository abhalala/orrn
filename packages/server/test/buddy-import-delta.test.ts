/**
 * orrn buddy, import drafts in the delta round (lead decisions 3 and 4; review S2, S3). Real D1, through `/mcp` and
 * `buddy.drafts.*`.
 *
 * Pins:
 * - S2: the stored dry run outcome comes from the candidate's own state when the browser reports, never from the
 *   browser's word: `ready`/`held` is done, `processing` is stopped, anything else failed.
 * - S3: an ingest draft keeps the candidate seq it expects (`basis_seq`, counting earlier pending drafts on the same
 *   candidate). Drafts made together still run in order; a change made any other way (the person on the review page)
 *   makes the old draft fail with STALE_DRAFT_FAILURE, and so does confirming out of the chain.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { buddyDraft } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { draft, importPlant, pump } from "./buddy-import-fixture";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const STALE = "The sheet changed after this was drafted. Ask Buddy again.";

async function stored(draftId: string) {
  return env.db.select({ result: buddyDraft.resultJson, basisSeq: buddyDraft.basisSeq, notedAt: buddyDraft.notedAt }).from(buddyDraft).where(eq(buddyDraft.id, draftId)).get();
}

describe("S2: the dry run outcome is the candidate's own state", () => {
  test("a table discarded while the bubble drives is stored as failed with its state, even when the browser says done", async () => {
    const { p, token, candidateId } = await importPlant(env, 3);
    const run = await draft(env, token, "orrn_import_dry_run", { candidateId });
    expect((await p.owner.buddy.drafts.confirm({ draftId: run, via: "bubble" })).status).toBe("confirmed");
    const c = await p.owner.ingest.candidate.get({ candidateId });
    await p.owner.ingest.candidate.discard({ candidateId, expectSeq: c.serverSeq });
    const view = await p.owner.buddy.drafts.report({ draftId: run, outcome: "done", summary: "Synthetic run finished" });
    expect((view.result as { dryRun?: unknown }).dryRun).toEqual({ outcome: "failed", state: "discarded" });
    expect((await stored(run))?.result).toMatchObject({ dryRun: { outcome: "failed", state: "discarded" } });
    expect(JSON.stringify((await stored(run))?.result)).not.toContain("Synthetic run finished");
    expect(view.drive).toBeNull();
  });

  test("a table still processing reported as done is stored as stopped", async () => {
    const { p, token, candidateId } = await importPlant(env, 3);
    const run = await draft(env, token, "orrn_import_dry_run", { candidateId });
    await p.owner.buddy.drafts.confirm({ draftId: run, via: "bubble" });
    const view = await p.owner.buddy.drafts.report({ draftId: run, outcome: "done" });
    expect((view.result as { dryRun?: unknown }).dryRun).toEqual({ outcome: "stopped", state: "processing" });
  });

  test("a table that reached ready is done, whatever the browser says", async () => {
    const { p, token, candidateId } = await importPlant(env, 3, false);
    const run = await draft(env, token, "orrn_import_dry_run", { candidateId });
    await p.owner.buddy.drafts.confirm({ draftId: run, via: "bubble" });
    await pump(p.owner, candidateId);
    const view = await p.owner.buddy.drafts.report({ draftId: run, outcome: "failed" });
    expect((view.result as { dryRun?: unknown }).dryRun).toEqual({ outcome: "done", state: "ready" });
    expect((await stored(run))?.notedAt).toBeNull();
  });
});

describe("S3: an old draft never runs over a later change", () => {
  async function readySheet() {
    const plant = await importPlant(env, 2, false);
    await pump(plant.p.owner, plant.candidateId);
    const seen = await plant.p.owner.ingest.candidate.get({ candidateId: plant.candidateId });
    expect(seen.state).toBe("ready");
    return { ...plant, seq: seen.serverSeq };
  }

  test("drafts made together run in order: basis_seq counts the earlier pending draft on the same candidate", async () => {
    const { p, token, candidateId, seq } = await readySheet();
    const hold = await draft(env, token, "orrn_call", { path: "ingest.candidate.hold", input: { candidateId, reason: "synthetic check", expectSeq: seq } });
    const release = await draft(env, token, "orrn_call", { path: "ingest.candidate.release", input: { candidateId, expectSeq: seq } });
    expect((await stored(hold))?.basisSeq).toBe(seq);
    expect((await stored(release))?.basisSeq).toBe(seq + 1);
    // The card never shows the seq.
    const card = (await p.owner.buddy.drafts.listMine()).find((d) => d.id === release)!;
    expect(JSON.stringify(card.fields)).not.toContain("basis");
    expect(await p.owner.buddy.drafts.confirm({ draftId: hold, via: "bubble" })).toMatchObject({ status: "confirmed", failure: null });
    expect(await p.owner.buddy.drafts.confirm({ draftId: release, via: "bubble" })).toMatchObject({ status: "confirmed", failure: null });
  });

  test("the person changed the sheet on the review page after the draft: Confirm fails with plain words and runs nothing", async () => {
    const { p, token, candidateId, seq } = await readySheet();
    const old = await draft(env, token, "orrn_call", { path: "ingest.candidate.setTarget", input: { candidateId, target: "orders", expectSeq: seq } });
    // The owner works on the review page directly.
    await p.owner.ingest.candidate.setTarget({ candidateId, target: "die_copies", expectSeq: seq });
    const out = await p.owner.buddy.drafts.confirm({ draftId: old, via: "settings" });
    expect(out).toMatchObject({ status: "failed", failure: STALE });
    const after = await p.owner.ingest.candidate.get({ candidateId });
    expect(after.target).toBe("die_copies");
  });

  test("two drafts of one turn: the person ignores the first and changes the sheet; the second fails too", async () => {
    const { p, token, candidateId, seq } = await readySheet();
    const first = await draft(env, token, "orrn_call", { path: "ingest.candidate.setTarget", input: { candidateId, target: "orders", expectSeq: seq } });
    const second = await draft(env, token, "orrn_call", { path: "ingest.candidate.setTarget", input: { candidateId, target: "bundles", expectSeq: seq } });
    // One change on the review page moves the seq by one, the same as the first draft would have.
    await p.owner.ingest.candidate.setTarget({ candidateId, target: "die_copies", expectSeq: seq });
    expect(await p.owner.buddy.drafts.confirm({ draftId: second, via: "bubble" })).toMatchObject({ status: "failed", failure: STALE });
    expect((await p.owner.ingest.candidate.get({ candidateId })).target).toBe("die_copies");
    expect(await p.owner.buddy.drafts.confirm({ draftId: first, via: "bubble" })).toMatchObject({ status: "failed", failure: STALE });
  });
});
