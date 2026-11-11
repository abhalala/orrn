import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type ViteDevServer } from "vite";
import type { ReactNode } from "react";

import type {
  ArtifactDetail,
  ArtifactSummary,
  CandidateCounts,
  CandidateState,
  CandidateSummary,
  MergeCandidateResult,
  MergeRunView,
  UploadItem,
  useMergePump,
} from "../lib";

/**
 * Component tests for the upload area, the candidates list, the file screen and the merge screen (work order 3.1,
 * 3.2, 3.5, 3.6). Each state of the work order is drawn on the server and its text and its one primary action are
 * read back. The pages are rendered at the phone layout (no browser here, so `ResponsiveList` stacks).
 */

let server: ViteDevServer;
let createElement: typeof import("react").createElement;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let CandidateBoard: typeof import("./candidate-board").CandidateBoard;
let UploadStrip: typeof import("./upload-strip").UploadStrip;
let StagedFiles: typeof import("./upload-strip").StagedFiles;
let IngestUploadScreen: typeof import("./upload-screen").IngestUploadScreen;
let IngestFileScreen: typeof import("./file-screen").IngestFileScreen;
let MergeBody: typeof import("./merge-screen").MergeBody;
let uploadStrip: typeof import("../lib/list-model").uploadStrip;
let ingestKeys: typeof import("../lib/queries").ingestKeys;

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
  const dir = "/src/features/ingest";
  createElement = react.createElement;
  QueryClient = query.QueryClient;
  QueryClientProvider = query.QueryClientProvider;
  renderToStaticMarkup = renderer.renderToStaticMarkup;
  CandidateBoard = (await server.ssrLoadModule(`${dir}/components/candidate-board.tsx`)).CandidateBoard;
  const strip = await server.ssrLoadModule(`${dir}/components/upload-strip.tsx`);
  UploadStrip = strip.UploadStrip;
  StagedFiles = strip.StagedFiles;
  IngestUploadScreen = (await server.ssrLoadModule(`${dir}/components/upload-screen.tsx`)).IngestUploadScreen;
  IngestFileScreen = (await server.ssrLoadModule(`${dir}/components/file-screen.tsx`)).IngestFileScreen;
  MergeBody = (await server.ssrLoadModule(`${dir}/components/merge-screen.tsx`)).MergeBody;
  uploadStrip = (await server.ssrLoadModule(`${dir}/lib/list-model.ts`)).uploadStrip;
  ingestKeys = (await server.ssrLoadModule(`${dir}/lib/queries.ts`)).ingestKeys;
}, 30_000);

afterAll(async () => {
  await server?.close();
});

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 1400, create: 1400, update: 0, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0, ...over,
});

const cand = (over: Partial<CandidateSummary> & { counts?: Partial<CandidateCounts> } = {}): CandidateSummary => {
  const { counts: c, ...rest } = over;
  return {
    id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "dies", holeRef: null, holeName: null,
    fit: "exact", fitScore: 1000, state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 3, dryCursor: 0,
    counts: counts(c), openQuestions: 0, botAttempts: 0, recipeLocked: false, fileName: "dies-b-RCQCZ.csv",
    sheetName: "Sections", blockOrdinal: 0, updatedAt: 0, ...rest,
  };
};

const artifact = (over: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id: "a1", sha256: "x", fileName: "dies-b-RCQCZ.csv", contentType: "text/csv", kind: "csv", sizeBytes: 10, vaultState: "stored",
  readState: "read", readError: null, blockCount: 1, rowCount: 1400, period: null, periodConfirmed: null, note: null,
  uploadedBy: null, createdAt: Date.UTC(2026, 10, 11, 6), ...over,
});

type Seed = (client: InstanceType<typeof QueryClient>) => void;

function render(node: ReactNode, seed?: Seed): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([["auth", "me"], { type: "query" }], { company: { role: "owner" }, isPlatformAdmin: false });
  seed?.(client);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

const board = (candidates: CandidateSummary[], over: Record<string, unknown> = {}) =>
  createElement(CandidateBoard, {
    candidates, artifacts: [artifact()], activeRunId: null, canMerge: true, canUpload: true, announce: () => {}, ...over,
  } as never);

const count = (html: string, text: string) => html.split(text).length - 1;

// ---------------------------------------------------------------------------------------------
// 3.1 Upload
// ---------------------------------------------------------------------------------------------

const seedList = (list: CandidateSummary[], artifacts: ArtifactSummary[] = [artifact()]): Seed => (client) => {
  client.setQueryData(ingestKeys.candidates(), list);
  client.setQueryData(ingestKeys.artifacts(), artifacts);
  client.setQueryData(ingestKeys.status(), {
    botReady: true, vaultReady: true, limits: { filesPerUpload: 20 }, activeRunId: null, botToday: 0,
  });
};

describe("upload area", () => {
  test("with nothing imported yet it is one big drop zone: title, hint, Choose files, no note field", () => {
    const html = render(createElement(IngestUploadScreen), seedList([]));
    expect(html).toContain("Drop files here");
    expect(html).toContain("Choose files");
    expect(html).toContain("Excel, CSV, database export or PDF. Up to 20 files.");
    // The button is described by the hint (WCAG 1.3.1).
    expect(html).toMatch(/aria-describedby="[^"]+"[^>]*>Choose files/);
    expect(html).not.toContain("Note for these files");
    expect(html).not.toContain("Add files");
    expect(html).not.toContain("Merge");
  });

  test("once imports exist the drop zone goes and the header offers Add files", () => {
    const html = render(createElement(IngestUploadScreen), seedList([cand()]));
    expect(html).toContain("Add files");
    expect(html).not.toContain("Drop files here");
    expect(html).not.toContain("Note for these files");
    expect(html).toContain("Bring in old sheets, exports and packing lists. Nothing changes in orrn until you merge.");
  });

  test("the vault and helper notices are one muted line each, not a boxed notice", () => {
    const html = render(createElement(IngestUploadScreen), (client) => {
      seedList([cand()])(client);
      client.setQueryData(ingestKeys.status(), { botReady: false, vaultReady: false, limits: { filesPerUpload: 20 }, activeRunId: null, botToday: 0 });
    });
    expect(html).toContain("File storage is not set up for this plant, so the original file is not kept. Ask orrn support to turn it on.");
    expect(html).toContain("orrn cannot suggest a layout for this plant yet. Map the columns yourself.");
    expect(html).not.toContain('data-tone="neutral"');
  });

  test("chosen files show the note field above one row for each file and the one primary button", () => {
    const html = render(createElement(StagedFiles, {
      files: [{ name: "dies-b-RCQCZ.csv" }, { name: "bundles-q.csv" }], note: "", onNote: () => {}, onRemove: () => {}, onStart: () => {}, onCancel: () => {},
    }));
    expect(html).toContain("Note for these files (optional)");
    expect(html.indexOf("Note for these files")).toBeLessThan(html.indexOf("dies-b-RCQCZ.csv"));
    expect(html).toContain("Remove: bundles-q.csv");
    expect(html).toContain("Add 2 files");
    expect(count(html, 'data-variant="primary"')).toBe(1);
  });
});

describe("files being added", () => {
  const fmt = { count: (n: number) => n.toLocaleString("en-IN"), date: () => "11 Nov" };
  const item = (over: Partial<UploadItem>): UploadItem => ({
    id: "up-1", name: "dies-b-RCQCZ.csv", size: 10, kind: "csv", step: "queued", progress: null, sent: null, artifactId: null,
    seenOn: null, notStored: false, problem: null, ...over,
  });
  const strip = (items: UploadItem[], list: CandidateSummary[] = []) =>
    render(createElement(UploadStrip, { entries: uploadStrip(items, list, fmt), headingId: "h", onRetry: () => {}, onRemove: () => {} }));

  test("reading shows the rows read with Indian grouping and a bar", () => {
    const html = strip([item({ step: "reading", progress: { sheet: "Sheet1", rowsRead: 820, rowsTotal: 1400 } as never })]);
    expect(html).toContain("Reading 820 of 1,400 rows");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="59"');
    expect(html).toContain("Remove: dies-b-RCQCZ.csv");
  });

  test("a file that was read says what was found, with one Review button to the import", () => {
    const html = strip([item({ step: "done", artifactId: "a1" })], [cand({ id: "c9" })]);
    expect(html).toContain("Read. 1 table: Dies, Known layout.");
    expect(html).toContain('href="/ingest/review/c9"');
    expect(html).toContain('aria-label="Review: dies-b-RCQCZ.csv"');
  });

  test("imports being checked show a blue Checking rows chip and a bar, and no action", () => {
    const html = strip([], [cand({ id: "c2", state: "processing", counts: { total: 100, create: 40 } })]);
    expect(html).toContain('data-tone="blue"');
    expect(html).toContain("Checking rows");
    expect(html).toContain('aria-valuenow="40"');
    expect(html).not.toContain("Review");
  });

  test("a file seen before says when it was added and offers Open it", () => {
    const html = strip([item({ step: "seenBefore", artifactId: "a1", seenOn: Date.UTC(2026, 10, 11) })]);
    expect(html).toContain("You added this file on 11 Nov.");
    expect(html).toContain("Open it");
    expect(html).toContain('href="/ingest/files/a1"');
  });

  test("a failed file says so and offers Try again", () => {
    const html = strip([item({ step: "failed" })]);
    expect(html).toContain("orrn could not read this file.");
    expect(html).toContain("Try again");
  });

  test("a refused file gives the reason in words", () => {
    const html = strip([item({ step: "refused", problem: { key: "ingest.drop.tooManyRows", vars: { name: "dies-b-RCQCZ.csv" } } as never })]);
    expect(html).toContain("has more than 200,000 rows");
  });
});

// ---------------------------------------------------------------------------------------------
// 3.2 Candidates list
// ---------------------------------------------------------------------------------------------

describe("candidates list", () => {
  const needsYou = [
    cand({ id: "n1", state: "needs_shape", target: null, sheetName: "Sheet2", fit: "none" }),
    cand({ id: "n2", state: "needs_confirm", target: null, sheetName: null, fit: "near", holeName: "Die list" }),
    cand({ id: "n3", state: "held", reasonCode: "merge_failed", reasonDetail: "Bundle LRCQCZ is already in orrn." }),
    cand({ id: "n4", state: "ready", openQuestions: 1, counts: { ambiguous: 1 } }),
  ];

  test("Needs you is the first segment shown, with one chip and one primary action for each row", () => {
    // The label carries a line break before the count: on a phone it stacks, from sm up it is one line.
    const html = render(board(needsYou));
    expect(html).toContain("Needs you\n4");
    expect(html).toContain("Ready\n0");
    expect(html).toContain("Approved\n0");
    expect(html).toContain("Merged\n0");
    // The status block is amber with the count of imports that need a person.
    expect(html).toContain('data-tone="amber"');
    expect(html).toMatch(/Needs you<\/span>/);
    // One action each: Map columns, Check layout, Review (held), Review (question).
    expect(html).toContain('aria-label="Map columns: Sheet2, dies-b-RCQCZ.csv"');
    expect(html).toContain('aria-label="Check layout: New table, dies-b-RCQCZ.csv"');
    expect(html).toContain('aria-label="Review: Dies, dies-b-RCQCZ.csv"');
    expect(count(html, 'data-variant="primary"')).toBe(4);
    // Chips say the state; a ready import with an open question says so in amber, not Ready.
    expect(html).toContain("Needs a layout");
    expect(html).toContain("Check the layout");
    expect(html).toContain("Held");
    expect(html).toContain("1 question");
    // Not on the list: Discard, a second fit chip, a merge button, the old card words.
    expect(html).not.toContain("Discard");
    expect(html).not.toContain("Merge 1");
    expect(html).not.toContain("Looks familiar");
  });

  test("the reason of a held import is under it, with the server's English marked", () => {
    const html = render(board(needsYou));
    expect(html).toContain('Not merged. </span><span lang="en">Bundle LRCQCZ is already in orrn.</span>');
  });

  test("a file group has its name, how many tables and when it was added", () => {
    const html = render(board(needsYou));
    expect(html).toContain('data-testid="ingest-file-group"');
    expect(html).toContain("dies-b-RCQCZ.csv");
    expect(html).toContain("4 tables, added 11 Nov");
  });

  test("Ready rows have Approve; two exact fits of a parser-read file offer Approve all 2 and nothing else loud", () => {
    const list = [cand({ id: "r1" }), cand({ id: "r2", blockOrdinal: 1, sheetName: "Sections 2" })];
    const html = render(board(list));
    expect(html).toContain("Ready\n2");
    expect(html).toContain('aria-label="Approve: Dies, dies-b-RCQCZ.csv"');
    expect(html).toContain("Approve all 2");
    expect(html).toContain('aria-label="Approve all 2: dies-b-RCQCZ.csv"');
    expect(html).not.toContain("Hold");
    expect(html).toContain("Approve imports, then merge them together.");
    expect(html).not.toContain('data-slot="ingest-bar"');
  });

  test("a file read by a model never offers Approve all", () => {
    const list = [cand({ id: "r1" }), cand({ id: "r2", blockOrdinal: 1 })];
    const html = render(board(list, { artifacts: [artifact({ kind: "pdf_scan" })] }));
    expect(html).not.toContain("Approve all");
  });

  test("Approved rows have Hold and the sticky bar offers one Merge button with the rows that will be added", () => {
    const list = [
      cand({ id: "p1", state: "approved", counts: { total: 1400, create: 1400 } }),
      cand({ id: "p2", state: "approved", counts: { total: 2, create: 2, update: 1 }, blockOrdinal: 1 }),
    ];
    const html = render(board(list, { initialSegment: "approved" }));
    expect(html).toContain("Ready to merge");
    expect(html).toContain("1,402 rows will be added, 1 updated");
    expect(html).toContain('aria-label="Hold: Dies, dies-b-RCQCZ.csv"');
    expect(html).toContain('data-slot="ingest-bar"');
    expect(html).toContain("2 imports approved, 1,403 rows");
    expect(html).toContain("Merge 2 approved imports");
    expect(html).toContain('data-tone="green"');
    expect(html).not.toContain("Approve imports, then merge");
  });

  test("while a merge runs the bar links to it instead of offering Merge", () => {
    const list = [cand({ id: "p1", state: "approved" })];
    const html = render(board(list, { initialSegment: "approved", activeRunId: "run-9" }));
    expect(html).toContain('href="/ingest/merge/run-9"');
    expect(html).toContain("Merging");
    expect(html).not.toContain("Merge 1 approved import");
  });

  test("Merged rows have no action, and a person who cannot merge sees no bar and no Approve", () => {
    const merged = render(board([cand({ id: "m1", state: "merged" })], { initialSegment: "merged" }));
    expect(merged).toContain("Merged");
    expect(merged).not.toContain('data-slot="button"');
    const viewer = render(board([cand({ id: "r1" })], { canMerge: false, canUpload: false, initialSegment: "ready" }));
    expect(viewer).toContain('aria-label="Review: Dies, dies-b-RCQCZ.csv"');
    expect(viewer).not.toContain("Approve imports, then merge");
  });

  test("an empty segment says so in words", () => {
    const html = render(board([cand({ id: "r1" })], { initialSegment: "merged" }));
    expect(html).toContain("Nothing under Merged right now.");
  });

  test("each stacked row names the layout, the four counts and numbers in mono", () => {
    const html = render(board([cand({ id: "r1", counts: { total: 1400, create: 1400, update: 0, refused: 0 } })], { initialSegment: "ready" }));
    expect(html).toContain("Known layout");
    expect(html).toContain("New");
    expect(html).toContain("Updates");
    expect(html).toContain("Questions");
    expect(html).toContain("Cannot import");
    expect(html).toContain('<span class="font-mono tabular-nums text-foreground">1,400</span>');
    expect(html).toContain('text-muted-foreground">0</span>');
  });
});

// ---------------------------------------------------------------------------------------------
// 3.5 File
// ---------------------------------------------------------------------------------------------

describe("file screen", () => {
  const detail = (over: Partial<ArtifactDetail> = {}, target: CandidateSummary["target"] = "dies"): ArtifactDetail => ({
    ...artifact(),
    blocks: [{
      id: "b1", ordinal: 0, sheetName: "Sections", title: null, headerRow: 0, headerRows: 1, headers: ["Series", "Section code"], kinds: [],
      headerKey: "", columnCount: 2, rowCount: 1400, rowsPut: 1400, sample: [], readBy: "parser", modelChecked: false, canonicalStored: true,
      candidates: [cand({ target })],
    }],
    ...over,
  } as ArtifactDetail);
  const file = (data: ArtifactDetail) =>
    render(createElement(IngestFileScreen, { artifactId: "a1" }), (client) => client.setQueryData(ingestKeys.artifact("a1"), data));

  test("the file name is the title, then rows, tables and the day, one muted vault line, and the table as a list row", () => {
    const html = file(detail({ vaultState: "not_stored" }));
    expect(html).toContain("<h1");
    expect(html).toContain(">dies-b-RCQCZ.csv</h1>");
    expect(html).toContain("1,400 rows, 1 table, added on 11 Nov 2026");
    expect(html).toContain("Original file not kept");
    expect(html).toContain("Columns in the file: Series, Section code");
    expect(html).toContain('aria-label="Approve: Dies, dies-b-RCQCZ.csv"');
    expect(html).not.toContain("Table 1");
    expect(html).not.toContain("Looks familiar");
    // No year line for a file of dies.
    expect(html).not.toContain("Which financial year");
  });

  test("a file of bundles asks the year once, with the guess in the select and Save year", () => {
    const html = file(detail({}, "bundles"));
    expect(html).toContain("Which financial year is this file from?");
    expect(html).toContain("orrn found nothing in the file to tell the year.");
    expect(html).toContain("Save year");
    expect(html).toContain("As on date");
    expect(count(html, "Which financial year")).toBe(1);
  });

  test("a saved year reads as one line with Change", () => {
    const html = file(detail({ periodConfirmed: { fy: "2025-26", asOf: "2026-03-31" } }, "orders"));
    expect(html).toContain("Financial year 2025-26, as on 31 Mar 2026");
    expect(html).toContain("Change");
    expect(html).not.toContain("Save year");
  });
});

// ---------------------------------------------------------------------------------------------
// 3.6 Merge
// ---------------------------------------------------------------------------------------------

const result = (over: Partial<MergeCandidateResult> = {}): MergeCandidateResult => ({
  candidateId: "c1", target: "dies", state: "merging", reasonCode: null, reasonDetail: null, rowsWritten: 0, rowsCreate: 700, rowsUpdate: 0,
  fileName: "dies-b-RCQCZ.csv", sheetName: "Sections", ...over,
});

const run = (over: Partial<MergeRunView> = {}): MergeRunView => ({
  id: "r1", state: "running", cursor: 1, chunksTotal: 2, chunksWritten: 0, chunksFailed: 0, serverSeq: 2, startedBy: null, startedAt: 0,
  finishedAt: null, candidates: [], failedChunks: [], ...over,
});

const pumpOf = (r: MergeRunView, over: Partial<ReturnType<typeof useMergePump>> = {}): ReturnType<typeof useMergePump> => ({
  phase: r.state === "running" || r.state === "planning" ? "running" : "done", run: r, results: r.candidates,
  chunksTotal: r.chunksTotal, chunksWritten: r.chunksWritten, chunksFailed: r.chunksFailed, error: null, retry: () => {},
  stop: async () => {}, ...over,
});

const merge = (r: MergeRunView, over: Partial<ReturnType<typeof useMergePump>> = {}) =>
  render(createElement(MergeBody, { pump: pumpOf(r, over), run: r }));

describe("merge screen", () => {
  const two = [
    result({ candidateId: "c1", rowsWritten: 350, rowsCreate: 700 }),
    result({ candidateId: "c2", target: "bundles", rowsWritten: 0, rowsCreate: 1, fileName: "bundles-q.csv", sheetName: null }),
  ];

  test("running: a blue block with rows written of rows planned, a bar by rows, Stop after this part, one card of imports", () => {
    const html = merge(run({ candidates: two }));
    expect(html).toContain('data-tone="blue"');
    expect(html).toContain(">Merging</span>");
    expect(html).toContain("of 701 rows");
    expect(html).toContain("Part 1 of 2");
    // 350 of 701 rows is 50 percent, by rows and not by parts.
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain("Stop after this part");
    expect(html).toContain("Imports in this merge");
    expect(html).toContain('<span class="font-mono tabular-nums">350</span>');
    expect(html).toContain("Added ");
    // Labels are sans: no mono class on a label.
    expect(html).not.toContain("font-mono text-[13px]");
  });

  test("planning: the same block says Planning the merge and shows no number", () => {
    const html = merge(run({ state: "planning", chunksTotal: 0, candidates: two }));
    expect(html).toContain("Planning the merge");
    expect(html).not.toContain('data-slot="big-number"');
    expect(html).toContain("Stop after this part");
  });

  test("done: the headline counts only imports that merged and Back to imports is the primary action", () => {
    const html = merge(run({
      state: "done", chunksWritten: 2,
      candidates: [
        result({ candidateId: "c1", state: "merged", rowsWritten: 2_00_000, rowsCreate: 2_00_000, rowsUpdate: 3 }),
        result({ candidateId: "c2", state: "merged", target: "bundles", rowsWritten: 1, rowsCreate: 1, fileName: "bundles-q.csv", sheetName: null }),
      ],
    }));
    expect(html).toContain('data-tone="green"');
    expect(html).toContain("2,00,001");
    expect(html).toContain("rows added");
    expect(html).toContain("3 updated");
    expect(html).toContain("Back to imports");
    expect(html).toContain("See Dies");
    expect(html).toContain('href="/dies"');
    expect(html).toContain("See Bundles in stock");
    expect(html).toContain('href="/stock/bundles"');
    expect(count(html, 'data-variant="primary"')).toBe(1);
    expect(html).not.toContain("Stop after this part");
    // The result heading takes focus when the run finishes.
    expect(html).toContain('tabindex="-1" class="sr-only outline-none">Merge finished</h2>');
  });

  test("done with a hold: amber, the held import first with its reason in full and Open, zero counts left out", () => {
    const html = merge(run({
      state: "done_with_holds", chunksWritten: 1, chunksFailed: 1,
      candidates: [
        result({ candidateId: "c2", state: "merged", target: "bundles", rowsWritten: 2, rowsCreate: 2, rowsUpdate: 0, fileName: "bundles-q.csv", sheetName: null }),
        result({ candidateId: "c1", state: "held", rowsWritten: 0, rowsCreate: 500, reasonCode: "merge_failed", reasonDetail: "Bundle LRCQCZ is already in orrn." }),
      ],
    }));
    expect(html).toContain('data-tone="amber"');
    expect(html).toContain("1 import not merged");
    // The 500 rows of the held import are not in the headline.
    expect(html).toContain('<span class="sr-only">2</span>');
    expect(html).toContain('Not merged. </span><span lang="en">Bundle LRCQCZ is already in orrn.</span>');
    expect(html).toContain('aria-label="Open: Dies, dies-b-RCQCZ.csv"');
    expect(html.indexOf("dies-b-RCQCZ.csv")).toBeLessThan(html.indexOf("bundles-q.csv"));
    expect(html).toContain("Added ");
    expect(html).not.toContain("Updated 0");
    expect(html).toContain('data-tone="blue"');
  });

  test("stopped: Merge stopped with the parts written and Merge the rest as the primary action", () => {
    const html = merge(run({ state: "stopped", chunksTotal: 2, chunksWritten: 1, candidates: two }));
    expect(html).toContain("Merge stopped");
    expect(html).toContain("1 of 2 parts written");
    expect(html).toContain("Merge the rest");
    expect(html).toContain("Back to imports");
    expect(count(html, 'data-variant="primary"')).toBe(1);
  });

  test("another tab runs it: the muted notice says so", () => {
    const html = merge(run({ candidates: two }), { phase: "otherTab" });
    expect(html).toContain("This merge is running in another tab.");
  });

  test("a failed step shows the error line with Try again", () => {
    const html = merge(run({ candidates: two }), { phase: "error", error: { code: "NETWORK", message: "x" } as never });
    expect(html).toContain("Try again");
  });
});
