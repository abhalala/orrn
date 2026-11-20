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
