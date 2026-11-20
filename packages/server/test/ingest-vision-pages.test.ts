/**
 * Vision read, contract section 4: the state of a page, derived from the vault, the page's run rows and
 * its blocks (`derivePage`, pure). The invariant the web relies on: `next: "retry"` comes back only when
 * the next `vision.readPage` makes a model call or rebuilds blocks; anything else is settled or manual.
 */
import { describe, expect, test } from "bun:test";

import "./env-mock";

import { derivePage, digitRuns, unseenCells, type PageFacts } from "../src/lib/ingest/vision";
import type { BotRunHistoryRow } from "../src/lib/ingest/bot";

const S = "claude-sonnet-5-5";
const H = "claude-haiku-5-5";
const run = (outcome: BotRunHistoryRow["outcome"], errorCodes: string[] | null = null, model = S): BotRunHistoryRow => ({ attempt: 1, model, outcome, errorCodes });
const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  page: 1,
  hasImage: true,
  hasTables: false,
  tablesInFile: null,
  history: [],
  blocks: [],
  skipped: false,
  fileBlocks: 0,
  ...over,
});
const model = (id: string, tables = 1) => ({ id, readBy: "model" as const, typed: false, tables });

describe("derivePage", () => {
  test("waiting, then ready with nothing asked", () => {
    expect(derivePage(facts({ hasImage: false }))).toMatchObject({ state: "waiting", next: null, attempts: 0, tables: 0 });
    expect(derivePage(facts())).toMatchObject({ state: "ready", next: null, reason: null });
  });

  test("settled pages: read (all tables), typed, skipped", () => {
    expect(derivePage(facts({ blocks: [model("a", 2), model("b", 2)], history: [run("recipe")], hasTables: true }))).toMatchObject({ state: "read", next: "done", tables: 2, blockIds: ["a", "b"] });
    expect(derivePage(facts({ blocks: [{ id: "t", readBy: "parser", typed: true, tables: 1 }], history: [run("no_target")] }))).toMatchObject({ state: "typed", next: "done" });
    expect(derivePage(facts({ skipped: true, history: [run("refused")] }))).toMatchObject({ state: "skipped", next: "done" });
  });

  test("a page with part of its tables as blocks is not read; it is rebuilt from the tables object", () => {
    expect(derivePage(facts({ blocks: [model("a", 3)], history: [run("recipe")], hasTables: true, tablesInFile: 3, fileBlocks: 1 }))).toMatchObject({ state: "ready", next: "retry", tables: 3 });
    // Without the object there is nothing to rebuild from.
    expect(derivePage(facts({ blocks: [model("a", 3)], history: [run("recipe")], hasTables: false, fileBlocks: 1 }))).toMatchObject({ state: "not_read", reason: "error", next: "manual" });
    // Without room for the rest, it is manual.
    expect(derivePage(facts({ blocks: [model("a", 3)], history: [run("recipe")], hasTables: true, tablesInFile: 3, fileBlocks: 49 }))).toMatchObject({ state: "not_read", reason: "too_many_tables", next: "manual" });
  });

  test("a recipe run with its tables in the vault and no block is a rebuild; with no object it is an error that may be read again", () => {
    expect(derivePage(facts({ history: [run("recipe")], hasTables: true, tablesInFile: 2 }))).toMatchObject({ state: "ready", next: "retry", tables: 2 });
    expect(derivePage(facts({ history: [run("recipe")], hasTables: true, tablesInFile: 2, fileBlocks: 49 }))).toMatchObject({ state: "not_read", reason: "too_many_tables" });
    expect(derivePage(facts({ history: [run("recipe")] }))).toMatchObject({ state: "not_read", reason: "error", canRetry: true, next: "manual", attempts: 1 });
    // A second such run is manual for good (two errors in a row).
    expect(derivePage(facts({ history: [run("recipe"), run("recipe")] }))).toMatchObject({ state: "not_read", reason: "error", canRetry: false });
  });

  test("retries and manual reasons follow the Sonnet plan", () => {
    expect(derivePage(facts({ history: [run("invalid", ["vision:row_width:0"])] }))).toMatchObject({ state: "ready", next: "retry", attempts: 1 });
    expect(derivePage(facts({ history: [run("invalid"), run("invalid")] }))).toMatchObject({ state: "not_read", reason: "invalid", canRetry: false });
    expect(derivePage(facts({ history: [run("invalid", ["output:truncated"]), run("invalid", ["output:truncated"])] }))).toMatchObject({ reason: "too_long" });
    expect(derivePage(facts({ history: [run("refused")] }))).toMatchObject({ reason: "refused", next: "manual" });
    expect(derivePage(facts({ history: [run("no_target")] }))).toMatchObject({ reason: "no_table" });
    expect(derivePage(facts({ history: [run("error")] }))).toMatchObject({ state: "ready", next: "retry" });
    expect(derivePage(facts({ history: [run("error"), run("error")] }))).toMatchObject({ reason: "error", canRetry: false });
    // Old Haiku history keeps its escalation.
    expect(derivePage(facts({ history: [run("invalid", null, H)] }))).toMatchObject({ state: "ready", next: "retry" });
    expect(derivePage(facts({ history: [run("invalid", null, H), run("invalid")] }))).toMatchObject({ reason: "invalid", next: "manual" });
  });

  test("a capped page is not read with its cap reason and may be read again; capped rows are not calls", () => {
    expect(derivePage(facts({ history: [run("capped", ["cap:day_calls"])] }))).toMatchObject({ state: "not_read", reason: "cap_day_calls", canRetry: true, attempts: 0 });
    expect(derivePage(facts({ history: [run("invalid"), run("capped", ["cap:day_cost"])] }))).toMatchObject({ reason: "cap_day_cost", canRetry: true, attempts: 1 });
    expect(derivePage(facts({ history: [run("error"), run("invalid"), run("error"), run("invalid"), run("capped", ["cap:block_calls"])] }))).toMatchObject({ reason: "cap_page", canRetry: true });
  });

  test("a full file is manual before any call", () => {
    expect(derivePage(facts({ fileBlocks: 50 }))).toMatchObject({ state: "not_read", reason: "too_many_tables", next: "manual", canRetry: false });
  });
});

describe("text-layer digit check (pure)", () => {
  test("digit runs drop a comma only between digits", () => {
    expect(digitRuns("1,23,456")).toEqual(["123456"]);
    expect(digitRuns("12, 34")).toEqual(["12", "34"]);
    expect(digitRuns("Rate 210.50/kg")).toEqual(["210", "50"]);
    expect(digitRuns("no digits")).toEqual([]);
  });

  test("whole runs are matched, never a part of one; items never join", () => {
    expect(unseenCells([["210"]], ["2100"])).toEqual([[0, 0]]);
    expect(unseenCells([["123456"]], ["1,23,456"])).toEqual([]);
    expect(unseenCells([["1,23,456"]], ["123456"])).toEqual([]);
    // Two items "12" and "34" are not the run "1234".
    expect(unseenCells([["1234"]], ["12", "34"])).toEqual([[0, 0]]);
    // A cell is marked when any one of its runs is missing; cells with no digits are never marked.
    expect(unseenCells([["S100 x 7", "Nova"]], ["S100", "7"])).toEqual([]);
    expect(unseenCells([["S100 x 8", "Nova"]], ["S100", "7"])).toEqual([[0, 0]]);
  });

  test("no text means no marks", () => {
    expect(unseenCells([["210"]], null)).toEqual([]);
  });
});

describe("derivePage: bands (contract section 11.3)", () => {
  const item = (over: Partial<{ hasImage: boolean; hasTables: boolean; history: BotRunHistoryRow[] }> = {}) => ({ hasImage: true, hasTables: false, history: [] as BotRunHistoryRow[], ...over });
  const done = () => item({ hasTables: true, history: [run("recipe")] });

  test("a dense scan read whole goes to bands with its headers; a text PDF builds its blocks", () => {
    const dense = { history: [run("recipe")], hasTables: true, tablesInFile: 1, largest: { rows: 101, headers: ["A", "B"] } };
    expect(derivePage(facts({ ...dense, bandable: true }))).toMatchObject({ state: "ready", next: "band", bandHeaders: ["A", "B"], bands: null });
    expect(derivePage(facts({ ...dense, bandable: false }))).toMatchObject({ state: "ready", next: "retry", bandHeaders: null });
    // At the threshold it is not dense.
    expect(derivePage(facts({ ...dense, largest: { rows: 100, headers: ["A"] }, bandable: true }))).toMatchObject({ next: "retry" });
  });

  test("a cut-off scan goes to bands at once with no headers; a text PDF keeps its retry and then too_long", () => {
    const cut = run("invalid", ["output:truncated"]);
    expect(derivePage(facts({ history: [cut], bandable: true }))).toMatchObject({ state: "ready", next: "band", bandHeaders: null });
    expect(derivePage(facts({ history: [cut] }))).toMatchObject({ state: "ready", next: "retry" });
    expect(derivePage(facts({ history: [cut, cut] }))).toMatchObject({ reason: "too_long" });
  });

  test("bands are read in order: waiting for an image, the next band, then the merge", () => {
    const band = (items: ReturnType<typeof item>[], band1Tables: number | null = null) => ({ total: items.length, items, band1Tables });
    // The whole-page history no longer decides anything, but its calls still count.
    const whole = { history: [run("recipe")], hasTables: true, bandable: true };
    expect(derivePage(facts({ ...whole, band: band([item({ hasImage: false }), item({ hasImage: false })]) }))).toMatchObject({ state: "waiting", next: null, attempts: 1, bands: { total: 2, read: 0, next: 1 } });
    expect(derivePage(facts({ ...whole, band: band([item(), item()]) }))).toMatchObject({ state: "ready", next: null, bands: { total: 2, read: 0, next: 1 } });
    expect(derivePage(facts({ ...whole, band: band([done(), item()], 2) }))).toMatchObject({ state: "ready", next: "retry", tables: 2, attempts: 2, bands: { total: 2, read: 1, next: 2 } });
    expect(derivePage(facts({ ...whole, band: band([done(), item({ hasImage: false })], 2) }))).toMatchObject({ state: "waiting", bands: { next: 2 } });
    // Every band read and no block yet: the next readPage merges, with no call.
    expect(derivePage(facts({ band: band([done(), done(), done()], 2) }))).toMatchObject({ state: "ready", next: "retry", tables: 2, bands: { total: 3, read: 3, next: null } });
    // Read only when every table is a block.
    expect(derivePage(facts({ band: band([done(), done()], 2), blocks: [model("a", 2)] }))).toMatchObject({ state: "ready", next: "retry" });
    expect(derivePage(facts({ band: band([done(), done()], 2), blocks: [model("a", 2), model("b", 2)] }))).toMatchObject({ state: "read", next: "done", bands: { read: 2, next: null } });
  });

  test("a band follows the Sonnet plan on its own key; a manual band makes the page manual", () => {
    const band = (items: ReturnType<typeof item>[]) => ({ total: items.length, items, band1Tables: 1 });
    expect(derivePage(facts({ band: band([done(), item({ history: [run("invalid", ["vision:band_width"])] })]) }))).toMatchObject({ state: "ready", next: "retry" });
    expect(derivePage(facts({ band: band([done(), item({ history: [run("invalid"), run("invalid")] })]) }))).toMatchObject({ state: "not_read", reason: "invalid", next: "manual" });
    expect(derivePage(facts({ band: band([item({ history: [run("no_target")] }), item()]) }))).toMatchObject({ reason: "no_table" });
    expect(derivePage(facts({ band: band([done(), item({ history: [run("capped", ["cap:day_cost"])] })]) }))).toMatchObject({ reason: "cap_day_cost", canRetry: true });
    // A full file is manual before any band call.
    expect(derivePage(facts({ band: band([item(), item()]), fileBlocks: 50 }))).toMatchObject({ reason: "too_many_tables" });
  });
});
