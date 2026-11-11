import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type ViteDevServer } from "vite";
import type { ReactNode } from "react";

import type {
  CandidateCounts,
  CandidateDetail,
  CandidateState,
  CandidateSummary,
  MergeRunView,
  useMergePump,
} from "../lib";

let server: ViteDevServer;
let createElement: typeof import("react").createElement;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let CandidateCard: typeof import("./candidate-card").CandidateCard;
let addMapping: typeof import("./mapping-editor").addMapping;
let buildRecipe: typeof import("../lib/recipe-builder").buildRecipe;
let updateMapping: typeof import("./mapping-editor").updateMapping;
let MergeBody: typeof import("./merge-screen").MergeBody;
let answerValue: typeof import("./questions-panel").answerValue;
let QuestionsPanel: typeof import("./questions-panel").QuestionsPanel;
let StagedRows: typeof import("./rows-table").StagedRows;
let questionView: typeof import("../lib").questionView;

beforeAll(async () => {
  const root = new URL("../../../../", import.meta.url).pathname;
  server = await createServer({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
    ssr: { external: ["react", "react-dom", "@tanstack/react-query"], noExternal: ["lucide-react"] },
  });
  const react = await import("react");
  const query = await import("@tanstack/react-query");
  const renderer = await import("react-dom/server");
  const i18n = await server.ssrLoadModule("@orrn/i18n");
  await i18n.loadMessages("en");
  const cards = await server.ssrLoadModule("/src/features/ingest/components/candidate-card.tsx");
  const mapping = await server.ssrLoadModule("/src/features/ingest/components/mapping-editor.tsx");
  const merge = await server.ssrLoadModule("/src/features/ingest/components/merge-screen.tsx");
  const questions = await server.ssrLoadModule("/src/features/ingest/components/questions-panel.tsx");
  const rows = await server.ssrLoadModule("/src/features/ingest/components/rows-table.tsx");
  const model = await server.ssrLoadModule("/src/features/ingest/lib/model.ts");
  createElement = react.createElement;
  QueryClient = query.QueryClient;
  QueryClientProvider = query.QueryClientProvider;
  renderToStaticMarkup = renderer.renderToStaticMarkup;
  CandidateCard = cards.CandidateCard;
  addMapping = mapping.addMapping;
  buildRecipe = (await server.ssrLoadModule("/src/features/ingest/lib/recipe-builder.ts")).buildRecipe;
  updateMapping = mapping.updateMapping;
  MergeBody = merge.MergeBody;
  answerValue = questions.answerValue;
  QuestionsPanel = questions.QuestionsPanel;
  StagedRows = rows.StagedRows;
  questionView = model.questionView;
}, 30_000);

afterAll(async () => {
  await server?.close();
});

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 6, create: 2, update: 1, unchanged: 0, ambiguous: 2, conflict: 1, refused: 0, skipped: 0, written: 0, ...over,
});

const summary = (over: Partial<CandidateSummary> = {}): CandidateSummary => ({
  id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "dies", holeRef: null, holeName: "Old sections",
  fit: "exact", fitScore: 1000, state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 3, dryCursor: 0,
  counts: counts(), openQuestions: 0, botAttempts: 0, recipeLocked: false, fileName: "dies.csv", sheetName: "Sections",
  blockOrdinal: 0, updatedAt: 0, ...over,
});

const detail = (over: Partial<CandidateDetail> = {}): CandidateDetail => ({
  ...summary(),
  recipe: null, fitDiff: null, questions: [],
  block: {
    id: "b1", ordinal: 0, sheetName: "Sections", title: null, headerRow: 0, headerRows: 1,
    headers: ["Code", "Minimum weight"], kinds: ["code", "decimal"], headerKey: "code|minimum weight",
    columnCount: 2, rowCount: 6, rowsPut: 6, sample: [], readBy: "parser", modelChecked: false,
  },
  period: null, periodConfirmed: null, rowsMissing: 0,
  ...over,
});

function render(node: ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([["auth", "me"], { type: "query" }], { company: { role: "owner" }, isPlatformAdmin: false });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

describe("candidate card states", () => {
  test("renders each candidate state with its text and row counts", () => {
    const states: [CandidateState, string][] = [
      ["processing", "Checking rows"], ["needs_confirm", "Check the layout"], ["needs_shape", "Needs a layout"],
      ["ready", "Ready"], ["held", "Held"], ["approved", "Approved"], ["merging", "Merging"],
      ["merged", "Merged"], ["failed", "Could not read"], ["discarded", "Discarded"],
    ];
    for (const [state, text] of states) {
      const html = render(createElement(CandidateCard, { candidate: summary({ state }) }));
      expect(html).toContain(`data-state="${state}"`);
      expect(html).toContain(text);
      expect(html).toContain("New");
      expect(html).toContain("Updates orrn");
    }
  });

  test("shows the reason for a held candidate", () => {
    const html = render(createElement(CandidateCard, {
      candidate: summary({ state: "held", reasonCode: "merge_failed", reasonDetail: "A duplicate row" }),
    }));
    // The server's own English detail sits in its own lang="en" span (work order M17).
    expect(html).toContain('Not merged. </span><span lang="en">A duplicate row</span>');
  });
});

describe("staged row filters", () => {
  test("shows all and only the states present, with the active filter named", () => {
    const html = render(createElement(StagedRows, { candidate: detail() }));
    expect(html).toContain("All 6");
    expect(html).toContain("Pick a match 2");
    expect(html).toContain("Differs from orrn 1");
    expect(html).toContain("New 2");
    expect(html).toContain("Updates orrn 1");
    expect(html).not.toContain("Cannot import");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Previous page");
    expect(html).toContain("Next page");
  });
});

describe("questions panel answer flow", () => {
  test("renders an open unit question and disables an answered yes or no question", () => {
    const candidate = detail({
      questions: [
        { code: "unit_unknown", subject: "weightMinG", params: { field: "weightMinG", kind: "linear_mass" }, answer: null, open: true },
        { code: "create_legacy_die", subject: "12170", params: { code: "12170" }, answer: true, open: false },
      ],
    });
    const html = render(createElement(QuestionsPanel, { candidate }));
    // The field is a label, never the code the server sent (work order S16).
    expect(html).toContain("Min weight per 12 ft has no unit. Which unit is it?");
    expect(html).toContain("kg/12ft");
    expect(html).toContain("Save");
    expect(html).toContain("12170 is not in your sections. Add it as an old section?");
    expect(html).toContain("disabled");
  });

  test("turns the selected control value into the action answer", () => {
    const unit = questionView({ code: "unit_unknown", subject: "weight", params: {}, answer: null, open: true });
    const column = questionView({ code: "column_meaning_unclear", subject: "A", params: {}, answer: null, open: true });
    const date = questionView({ code: "date_format_ambiguous", subject: "date", params: {}, answer: null, open: true });
    expect(answerValue(unit, "kg")).toEqual({ code: "unit_unknown", answer: "kg" });
    expect(answerValue(column, "sectionCode")).toEqual({ code: "column_meaning_unclear", answer: "sectionCode" });
    expect(answerValue(date, "dmy")).toEqual({ code: "date_format_ambiguous", answer: "dmy" });
  });
});

describe("mapping editor", () => {
  test("adds fields and applies a changed source column and unit to the recipe", () => {
    let rows = addMapping([], "dies");
    rows = addMapping(rows, "dies");
    rows = addMapping(rows, "dies");
    expect(rows.map((row) => row.field)).toEqual(["series", "sectionCode", "weightMinG"]);
    rows = updateMapping(rows, rows[2]!.id, { column: 1, unit: "kg/12ft" });
    const d = detail();
    const recipe = buildRecipe(
      { headers: d.block.headers, headerKey: d.block.headerKey, headerRow: d.block.headerRow, headerRows: d.block.headerRows },
      "dies", rows, null,
    );
    expect(recipe.fields).toHaveLength(1);
    expect(recipe.fields[0]!.source).toEqual({ kind: "columns", cols: [{ col: 1, header: "Minimum weight" }] });
    expect(recipe.fields[0]!.steps).toContainEqual({ op: "number", kind: "linear_mass", unit: "kg/12ft" });
  });
});

const mergeRun = (over: Partial<MergeRunView> = {}): MergeRunView => ({
  id: "r1", state: "running", cursor: 1, chunksTotal: 4, chunksWritten: 1, chunksFailed: 0,
  serverSeq: 2, startedBy: null, startedAt: 0, finishedAt: null, candidates: [], failedChunks: [], ...over,
});

const mergePump = (run: MergeRunView): ReturnType<typeof useMergePump> => ({
  phase: run.state === "running" ? "running" : "done", run, results: run.candidates,
  chunksTotal: run.chunksTotal, chunksWritten: run.chunksWritten, chunksFailed: run.chunksFailed,
  error: null, retry: () => {}, stop: async () => {},
});

describe("merge progress and holds", () => {
  test("announces the current part and exposes a labelled progress bar", () => {
    const run = mergeRun();
    const html = render(createElement(MergeBody, { pump: mergePump(run), run }));
    expect(html).toContain("Part 2 of 4");
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain("Stop after this part");
  });

  test("lists each held candidate with its reason and review link", () => {
    const run = mergeRun({
      state: "done_with_holds", chunksWritten: 0, chunksFailed: 1,
      candidates: [{
        candidateId: "c1", target: "dies", state: "held", reasonCode: "merge_failed", reasonDetail: "Duplicate section",
        rowsWritten: 0, rowsCreate: 0, rowsUpdate: 0, fileName: "dies.csv", sheetName: "Sections",
      }],
    });
    const html = render(createElement(MergeBody, { pump: mergePump(run), run }));
    expect(html).toContain("1 import was not merged. The reason is under each one.");
    expect(html).toContain('Not merged. </span><span lang="en">Duplicate section</span>');
    expect(html).toContain('href="/ingest/review/c1"');
  });
});
