import { describe, expect, test } from "bun:test";

import {
  FakeShapeClient,
  LOW_CONFIDENCE,
  MAX_PAGE_BYTES,
  MemoryBotRunStore,
  checkVisionTables,
  fakeRefusal,
  planVision,
  runVisionAttempt,
  toBase64,
  visionStartModel,
  type BotRunHistoryRow,
  type RunVisionArgs,
  type VisionAttemptResult,
} from "../src/lib/ingest/bot";
import { haiku, sonnet } from "./ingest-bot-fixture";

const table = (over: Record<string, unknown> = {}) => ({
  title: "Stock as on 31.10.2025",
  headers: ["Section", "Bundles"],
  rows: [["S100", "12"], ["S101", "7"], ["S102", ""]],
  rowConfidence: [0.95, 0.5, 0.2],
  ...over,
});
const answer = (...tables: unknown[]) => ({ tables });

function args(over: Partial<RunVisionArgs> = {}): RunVisionArgs {
  return {
    env: { ANTHROPIC_API_KEY: "sk-test" },
    store: new MemoryBotRunStore(),
    companyId: "co1",
    userId: "u1",
    blockId: "page1",
    pageKind: "pdf_scan",
    page: { mediaType: "image/jpeg", bytes: new Uint8Array([1, 2, 3, 250, 251, 252]) },
    vaultReady: true,
    // The vision read is off in the first portal release; these tests check the read itself.
    visualReads: true,
    nowMs: () => Date.UTC(2026, 10, 10, 12, 0, 0),
    ...over,
  };
}
function ran(r: VisionAttemptResult) {
  if (r.status !== "ran") throw new Error(`skipped: ${r.reason}`);
  return r;
}

describe("vision read", () => {
  test("without R2 the read is refused with vault_required and nothing is called", async () => {
    const client = new FakeShapeClient([]);
    const a = args({ client, vaultReady: false });
    expect(await runVisionAttempt(a)).toEqual({ status: "skipped", reason: "vault_required", next: "manual" });
    expect(client.calls).toHaveLength(0);
  });

  test("no key is skipped; a page that is not an image or is too big is refused", async () => {
    expect(await runVisionAttempt(args({ env: {} }))).toMatchObject({ status: "skipped", reason: "no_key" });
    const client = new FakeShapeClient([]);
    expect(await runVisionAttempt(args({ client, page: { mediaType: "application/pdf" as never, bytes: new Uint8Array(4) } }))).toMatchObject({ reason: "unsupported_page" });
    expect(await runVisionAttempt(args({ client, page: { mediaType: "image/jpeg", bytes: new Uint8Array(MAX_PAGE_BYTES + 1) } }))).toMatchObject({ reason: "page_too_large" });
    expect(await runVisionAttempt(args({ client, page: { mediaType: "image/jpeg", bytes: new Uint8Array(0) } }))).toMatchObject({ reason: "page_too_large" });
    expect(client.calls).toHaveLength(0);
  });

  test("scanned PDF pages start on Haiku, photos on Sonnet", () => {
    expect(visionStartModel("pdf_scan")).toBe("claude-haiku-5-5");
    expect(visionStartModel("image")).toBe("claude-sonnet-5-5");
  });

  test("the page goes out as a base64 image block with the vision purpose; no fallbacks on Haiku", async () => {
    const client = new FakeShapeClient([haiku(answer(table()))]);
    const a = args({ client });
    const r = ran(await runVisionAttempt(a));
    expect(r).toMatchObject({ outcome: "recipe", model: "claude-haiku-5-5", next: "done", attempt: 1 });
    const call = client.calls[0]!;
    expect(call).toMatchObject({ purpose: "vision", model: "claude-haiku-5-5", fallbacks: false, maxTokens: 8_000 });
    const parts = call.messages[0]!.content as { type: string; source?: { type: string; media_type: string; data: string } }[];
    expect(parts[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(new Uint8Array([1, 2, 3, 250, 251, 252])) } });
    expect(parts[0]!.source!.data).toBe("AQID+vv8");
    expect(call.system.at(-1)!.cache).toBe(true);
    expect((a.store as MemoryBotRunStore).rows[0]).toMatchObject({ purpose: "vision", blockId: "page1", outcome: "recipe" });
  });

  test("rows under 0.7 confidence are listed lowest first", async () => {
    const client = new FakeShapeClient([haiku(answer(table()))]);
    const r = ran(await runVisionAttempt(args({ client })));
    expect(LOW_CONFIDENCE).toBe(0.7);
    expect(r.tables![0]!.lowConfidenceRows).toEqual([2, 1]);
  });

  test("a photo starts on Sonnet with server-side fallbacks", async () => {
    const client = new FakeShapeClient([sonnet(answer(table()))]);
    const r = ran(await runVisionAttempt(args({ client, pageKind: "image" })));
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(client.calls[0]).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: true, maxTokens: 16_000 });
  });

  test("an invalid Haiku answer escalates to Sonnet with the error codes; Sonnet invalid is manual", async () => {
    const bad = answer(table({ rowConfidence: [0.9] }));
    const client = new FakeShapeClient([haiku(bad), sonnet(bad)]);
    const a = args({ client });
    const first = ran(await runVisionAttempt(a));
    expect(first).toMatchObject({ outcome: "invalid", next: "escalate", errors: ["vision:confidence_count:0"] });
    const second = ran(await runVisionAttempt(a));
    expect(second).toMatchObject({ outcome: "invalid", model: "claude-sonnet-5-5", next: "manual", attempt: 2 });
    const text = (client.calls[1]!.messages[0]!.content as { type: string; text?: string }[]).map((p) => p.text ?? "").join("\n");
    expect(text).toContain("vision:confidence_count:0");
    expect(await runVisionAttempt(a)).toMatchObject({ status: "skipped", reason: "attempts_exhausted" });
  });

  test("a Haiku refusal escalates to Sonnet; a Sonnet refusal is manual", async () => {
    const client = new FakeShapeClient([fakeRefusal(), fakeRefusal({ modelUsed: "claude-sonnet-5-5" })]);
    const a = args({ client });
    expect(ran(await runVisionAttempt(a))).toMatchObject({ outcome: "refused", next: "escalate" });
    expect(ran(await runVisionAttempt(a))).toMatchObject({ outcome: "refused", next: "manual" });
  });

  test("a page with no table is a final answer", async () => {
    const r = ran(await runVisionAttempt(args({ client: new FakeShapeClient([haiku(answer())]) })));
    expect(r).toMatchObject({ outcome: "no_target", next: "manual", tables: null });
  });

  test("a done page is not read twice; caps apply", async () => {
    const a = args({ client: new FakeShapeClient([haiku(answer(table()))]) });
    await runVisionAttempt(a);
    expect(await runVisionAttempt(a)).toMatchObject({ reason: "already_done" });

    const store = new MemoryBotRunStore();
    const hist = ["error", "invalid", "error", "invalid"] as const;
    for (const [i, outcome] of hist.entries()) {
      await store.insertRun({ companyId: "co1", blockId: "page1", candidateId: null, purpose: "vision", model: "claude-haiku-5-5", attempt: i + 1, outcome, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, durationMs: 0, createdBy: null, createdAtMs: Date.UTC(2026, 10, 10, 12), errorCodes: null });
    }
    const client = new FakeShapeClient([]);
    expect(ran(await runVisionAttempt(args({ client, store })))).toMatchObject({ outcome: "capped", next: "manual", capReason: "block_calls" });
    expect(client.calls).toHaveLength(0);
  });

  test("shape and vision runs of one block are counted apart", async () => {
    const store = new MemoryBotRunStore();
    for (let i = 0; i < 4; i++) {
      await store.insertRun({ companyId: "co1", blockId: "page1", candidateId: null, purpose: "shape", model: "claude-haiku-5-5", attempt: i + 1, outcome: "invalid", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, durationMs: 0, createdBy: null, createdAtMs: Date.UTC(2026, 10, 10, 12), errorCodes: null });
    }
    const r = ran(await runVisionAttempt(args({ store, client: new FakeShapeClient([haiku(answer(table()))]) })));
    expect(r.outcome).toBe("recipe");
  });

  test("planVision rows", () => {
    const H = "claude-haiku-5-5";
    const S = "claude-sonnet-5-5";
    const row = (attempt: number, model: string, outcome: BotRunHistoryRow["outcome"]): BotRunHistoryRow => ({ attempt, model, outcome });
    expect(planVision([row(1, H, "invalid")], H)).toMatchObject({ next: "escalate", model: S, carryErrors: true });
    expect(planVision([row(1, H, "refused")], H)).toMatchObject({ next: "escalate", model: S, carryErrors: false });
    expect(planVision([row(1, S, "invalid")], S)).toMatchObject({ next: "manual" });
    expect(planVision([row(1, H, "error")], H)).toMatchObject({ next: "retry", model: H });
    expect(planVision([row(1, H, "error"), row(2, H, "error")], H)).toMatchObject({ next: "manual" });
  });

  test("table checks catch width, confidence and size problems", () => {
    expect(checkVisionTables({ tables: [table()] as never })).toEqual([]);
    expect(checkVisionTables({ tables: [table({ rows: [["a"]] })] as never })).toContain("vision:row_width:0");
    expect(checkVisionTables({ tables: [table({ rowConfidence: [0.9, 1.4, 0.1] })] as never })).toContain("vision:confidence_range:0");
    expect(checkVisionTables({ tables: [table({ headers: [], rows: [], rowConfidence: [] })] as never })).toContain("vision:no_headers:0");
    expect(checkVisionTables({ tables: Array.from({ length: 6 }, () => table()) as never })).toContain("vision:too_many_tables");
  });

  test("base64 matches the standard encoding for large input", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
