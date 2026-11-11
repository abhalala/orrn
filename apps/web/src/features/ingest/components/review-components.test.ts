import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type ViteDevServer } from "vite";
import type { ReactNode } from "react";

import type { CandidateCounts, CandidateDetail, CandidateState, StagedRowView } from "../lib";

/**
 * The candidate review screen and the mapping editor (work order 3.3 and 3.4): each part rendered to a string in each
 * state the work order names, with the one primary action of that state. The parts are drawn from the view models of
 * `lib`, so these tests check the words, the buttons and the markup that carries the accessibility rules.
 */

let server: ViteDevServer;
let createElement: typeof import("react").createElement;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let lib: typeof import("../lib");
let bits: typeof import("./decision-bar");
let YearLine: typeof import("./period-panel").YearLine;
let QuestionsPanel: typeof import("./questions-panel").QuestionsPanel;
let ReadPanel: typeof import("./read-panel").ReadPanel;
let MappingEditor: typeof import("./mapping-editor").MappingEditor;
let rows: typeof import("./rows-table");

beforeAll(async () => {
  const root = new URL("../../../../", import.meta.url).pathname;
  server = await createServer({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
    // Radix would load its own copy of React. Inline it and resolve React from the app, so every hook sees one dispatcher.
    resolve: { dedupe: ["react", "react-dom"] },
    ssr: { external: ["react", "react-dom", "@tanstack/react-query"], noExternal: ["lucide-react", /^@radix-ui\//, "aria-hidden", "react-remove-scroll", "react-style-singleton", "use-callback-ref", "use-sidecar", "sonner", "vaul"] },
  });
  const react = await import("react");
  const query = await import("@tanstack/react-query");
  const renderer = await import("react-dom/server");
  const i18n = await server.ssrLoadModule("@orrn/i18n");
  await i18n.loadMessages("en");
  createElement = react.createElement;
  QueryClient = query.QueryClient;
  QueryClientProvider = query.QueryClientProvider;
  renderToStaticMarkup = renderer.renderToStaticMarkup;
  lib = await server.ssrLoadModule("/src/features/ingest/lib/index.ts");
  bits = await server.ssrLoadModule("/src/features/ingest/components/decision-bar.tsx");
  YearLine = (await server.ssrLoadModule("/src/features/ingest/components/period-panel.tsx")).YearLine;
  QuestionsPanel = (await server.ssrLoadModule("/src/features/ingest/components/questions-panel.tsx")).QuestionsPanel;
  ReadPanel = (await server.ssrLoadModule("/src/features/ingest/components/read-panel.tsx")).ReadPanel;
  MappingEditor = (await server.ssrLoadModule("/src/features/ingest/components/mapping-editor.tsx")).MappingEditor;
  rows = await server.ssrLoadModule("/src/features/ingest/components/rows-table.tsx");
}, 30_000);

afterAll(async () => {
  await server?.close();
});

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 3, create: 2, update: 1, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0, ...over,
});

const detail = (over: Partial<CandidateDetail> = {}): CandidateDetail => ({
  id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "dies", holeRef: null, holeName: null,
  fit: "exact", fitScore: 1000, state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 3, dryCursor: 0,
  counts: counts(), openQuestions: 0, botAttempts: 0, recipeLocked: false, fileName: "dies.csv", sheetName: "Sections",
  blockOrdinal: 0, updatedAt: 0,
  recipe: null, fitDiff: null, questions: [],
  block: {
    id: "b1", ordinal: 0, sheetName: "Sections", title: null, headerRow: 0, headerRows: 1,
    headers: ["Code", "Minimum weight", "Rate"], kinds: ["code", "decimal", "decimal"], headerKey: "code|minimum weight|rate",
    columnCount: 3, rowCount: 3, rowsPut: 3, sample: [["12170", "1.1", "950"], ["12171", "1.2", "960"]], readBy: "parser", modelChecked: false,
  },
  period: null, periodConfirmed: null, rowsMissing: 0,
  ...over,
});

const act = (over: Record<string, unknown> = {}) => ({
  busy: false, pending: null, failed: () => null, after: null,
  approve: async () => true, hold: async () => true, release: async () => true, confirmNear: async () => true,
  ignoreSheet: async () => true, answer: async () => true, skipRows: async () => true, decide: async () => true,
  saveYear: async () => true, saveShape: async () => true,
  ...over,
});
const focusRef = () => () => {};
const noop = () => {};

type Seed = [readonly unknown[], unknown];

function render(node: ReactNode, seeds: Seed[] = [], settings: Record<string, unknown> = {}): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([["auth", "me"], { type: "query" }], { company: { role: "owner", settings }, isPlatformAdmin: false });
  for (const [key, data] of seeds) client.setQueryData(key, data);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

const primaries = (html: string) => (html.match(/data-variant="primary"/g) ?? []).length;

function bar(c: CandidateDetail, ctx: Partial<{ merge: boolean; upload: boolean; botReady: boolean; editorOpen: boolean }> = {}) {
  return lib.decisionBar(c, {
    can: { merge: ctx.merge ?? true, upload: ctx.upload ?? true },
    botReady: ctx.botReady ?? true,
    editorOpen: ctx.editorOpen ?? false,
  });
}

function card(c: CandidateDetail, opts: { ctx?: Parameters<typeof bar>[1]; act?: ReturnType<typeof act>; after?: unknown; year?: ReactNode; editorOpen?: boolean } = {}) {
  return render(
    createElement(bits.DecisionBarCard, {
      candidate: c,
      bar: bar(c, opts.ctx),
      act: opts.act ?? act(),
      onPress: noop,
      onDiscard: noop,
      onIgnore: noop,
      onGoToFirstOpen: noop,
      editorOpen: opts.editorOpen ?? false,
      editorId: "editor",
      botWorking: false,
      year: opts.year ?? null,
      after: (opts.after ?? null) as never,
      barRef: noop,
    } as never),
  );
}

describe("decision bar by state (3.3, M7)", () => {
  test("ready with nothing to answer: Approve is the one primary, Hold is secondary, the effect is a sentence", () => {
    const html = card(detail());
    expect(html).toContain("Ready");
    expect(html).toContain("Adds 2 new and updates 1 in orrn.");
    expect(html).toContain("Known layout");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Hold<");
    expect(primaries(html)).toBe(1);
    expect(html).not.toContain("Answer ");
    // The overflow has Discard, behind a menu named for the import.
    expect(html).toContain('aria-label="More for Dies"');
  });

  test("ready with open questions: an amber chip and a link that goes to the first question, no Approve", () => {
    const html = card(detail({ openQuestions: 1, questions: [{ code: "unit_unknown", subject: "weightMinG", params: {}, answer: null, open: true }] }));
    expect(html).toContain("1 question");
    expect(html).toContain('data-tone="amber"');
    expect(html).toContain("Answer 1 question to approve.");
    expect(html).toContain('href="#review-first-open"');
    expect(html).not.toContain(">Approve<");
    expect(html).toContain(">Hold<");
    expect(primaries(html)).toBe(0);
  });

  test("rows that cannot be imported are said once, in the bar", () => {
    const html = card(detail({ counts: counts({ refused: 2 }) }));
    expect(html).toContain("2 rows cannot be imported.");
  });

  test("near fit: Use this layout is primary, No map the columns is secondary, the sentence counts the changed columns", () => {
    const html = card(detail({
      state: "needs_confirm", fit: "near", holeName: "My dies",
      fitDiff: { name: "My dies", renamed: [{ old: "Wt", new: "Minimum weight", col: 1 }], extra: [{ header: "Note", col: 2 }], missing: [] },
    }));
    expect(html).toContain("Check the layout");
    expect(html).toContain("This looks like your layout My dies. 2 columns changed.");
    expect(html).toContain(">Use this layout<");
    expect(html).toContain(">No, map the columns<");
    expect(primaries(html)).toBe(1);
    // The fit is not said twice: the state already says it.
    expect(html).not.toContain("Close to");
  });

  test("needs a layout with the helper ready: Map columns for me is primary, Map columns myself toggles the editor", () => {
    const c = detail({ state: "needs_shape", target: null, fit: "none" });
    const html = card(c);
    expect(html).toContain("Needs a layout");
    expect(html).toContain(">Map columns for me<");
    expect(html).toContain(">Map columns myself<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="editor"');
    expect(primaries(html)).toBe(1);
    // "Not data, skip this sheet" and Discard are in the overflow menu.
    expect(html).toContain('aria-label="More for Sections"');
  });

  test("needs a layout, editor open: the helper button turns secondary and the toggle says it is expanded", () => {
    const c = detail({ state: "needs_shape", target: null, fit: "none" });
    const html = card(c, { ctx: { editorOpen: true }, editorOpen: true });
    expect(html).toContain('aria-expanded="true"');
    // Both turn secondary: the one primary is now Save layout, inside the editor.
    expect(primaries(html)).toBe(0);
    expect(html).toContain(">Map columns myself<");
  });

  test("needs a layout, helper off: no Map columns for me, Map columns myself is the primary", () => {
    const c = detail({ state: "needs_shape", target: null, fit: "none" });
    const html = card(c, { ctx: { botReady: false } });
    expect(html).not.toContain("Map columns for me");
    expect(html).toContain(">Map columns myself<");
    expect(primaries(html)).toBe(1);
  });

  test("held: a blue chip, the reason in amber with the server's English in lang en, Check again is primary", () => {
    const html = card(detail({ state: "held", reasonCode: "merge_failed", reasonDetail: "Bundle LRCQCZ is already in orrn." }));
    expect(html).toContain('data-tone="blue"');
    expect(html).toContain("Held");
    expect(html).toContain('Not merged. </span><span lang="en">Bundle LRCQCZ is already in orrn.</span>');
    expect(html).toContain("text-tone-amber-ink");
    expect(html).toContain(">Check again<");
    expect(html).toContain(">Approve as it is<");
    expect(primaries(html)).toBe(1);
  });

  test("held with a question open: Approve as it is is not offered", () => {
    const html = card(detail({ state: "held", reasonCode: "merge_failed", reasonDetail: "x", openQuestions: 1 }));
    expect(html).toContain(">Check again<");
    expect(html).not.toContain("Approve as it is");
  });

  test("approved: the chip has a check, Hold and Go to merge are secondary, nothing is primary", () => {
    const html = card(detail({ state: "approved" }));
    expect(html).toContain("Approved");
    expect(html).toContain("lucide-check");
    expect(html).toContain(">Hold<");
    expect(html).toContain(">Go to merge<");
    expect(html).toContain('href="/ingest"');
    expect(primaries(html)).toBe(0);
  });

  test("merged: See the file is a link to the file, and nothing else is offered", () => {
    const html = card(detail({ state: "merged", counts: counts({ written: 3 }) }));
    expect(html).toContain("Merged");
    expect(html).toContain('href="/ingest/files/a1"');
    expect(html).toContain(">See the file<");
    expect(html).not.toContain(">Hold<");
    expect(primaries(html)).toBe(0);
  });

  test("checking rows: the sentence and no buttons", () => {
    const html = card(detail({ state: "processing" }));
    expect(html).toContain("Checking rows");
    expect(html).toContain("orrn is checking the rows.");
    expect(html).not.toContain("data-slot=\"button\"");
  });

  test("could not read: the plain next step, no Approve", () => {
    const html = card(detail({ state: "failed" }));
    expect(html).toContain("Could not read");
    expect(html).toContain("orrn could not read this file. Save it as Excel");
    expect(html).not.toContain(">Approve<");
  });

  test("a person who may not approve sees Hold only", () => {
    const html = card(detail(), { ctx: { merge: false } });
    expect(html).not.toContain(">Approve<");
    expect(html).toContain(">Hold<");
  });

  test("after Approve: the line, Next that needs you as the one primary, Go to merge said once", () => {
    const after = lib.afterDecision({ kind: "approved", approvedCount: 3, nextId: "c9" });
    const html = card(detail({ state: "approved" }), { after });
    expect(html).toContain("Approved. 3 imports approved so far.");
    expect(html).toContain('href="/ingest/review/c9"');
    expect(html).toContain(">Next that needs you<");
    expect(html.match(/>Go to merge</g)?.length).toBe(1);
    expect(primaries(html)).toBe(1);
  });

  test("after Hold: the next button is secondary when the bar already has a primary", () => {
    const after = lib.afterDecision({ kind: "held", approvedCount: 0, nextId: "c9" });
    const html = card(detail({ state: "held", reasonCode: "person", reasonDetail: "Wait" }), { after });
    expect(html).toContain("Held. It stays out of the merge until you check it again.");
    expect(primaries(html)).toBe(1);
    expect(html).not.toContain(">Go to merge<");
  });

  test("a write that is running makes every write button aria-disabled and never disabled", () => {
    const html = card(detail(), { act: act({ busy: true, pending: "approve" }) });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('disabled=""');
  });

  test("a failed write shows its words in an alert in the bar", () => {
    const html = card(detail(), { act: act({ failed: (area: string) => (area === "bar" ? { data: { code: "CONFLICT" } } : null) }) });
    expect(html).toContain('role="alert"');
    expect(html).toContain("This import changed while you were looking.");
  });

  test("the sticky bar repeats the buttons with the primary last", () => {
    const b = bar(detail());
    const html = render(
      createElement(bits.BarButtons, {
        buttons: [...b.buttons].reverse(), act: act(), onPress: noop, artifactId: "a1", editorOpen: false, editorId: "e", botWorking: false, quiet: true,
      } as never),
    );
    expect(html.indexOf(">Hold<")).toBeLessThan(html.indexOf(">Approve<"));
    expect(primaries(html)).toBe(1);
  });
});

describe("year line (3.3, M8)", () => {
  const line = (over: Record<string, unknown>) => lib.yearLine({ target: "bundles", questions: [], period: null, periodConfirmed: null, ...over } as never, (iso: string) => lib.plantUnitsFor({}).day(iso), new Date("2026-11-11T00:00:00Z"));
  const draw = (l: ReturnType<typeof line>, saved: { fy: string | null; asOf: string | null } | null = null) =>
    render(createElement(YearLine, { line: l, act: act(), announce: noop, saved } as never));

  test("asks with the guess and where it came from, the five years with the guess selected, Save year secondary", () => {
    const html = draw(line({ period: { fy: "2025-26", asOf: "2026-03-31", confidence: "medium", sources: [{ kind: "file_name", value: "2025-26" }] } }));
    expect(html).toContain("Which financial year is this file from?");
    expect(html).toContain("orrn guessed 2025-26 from the file name.");
    expect(html).toContain('<option value="2025-26" selected="">2025-26</option>');
    expect(html).toContain('<option value="2022-23">2022-23</option>');
    expect(html).toContain("Save year");
    expect(html).toContain('data-variant="secondary"');
    expect(html).not.toContain("autofocus");
    expect(html).toContain("orrn needs the as-on date to place opening stock.");
  });

  test("nothing to read the year from: says so and the select starts at Choose", () => {
    const html = draw(line({ period: { fy: null, asOf: null, confidence: "unknown", sources: [] } }));
    expect(html).toContain("orrn found nothing in the file to tell the year.");
    expect(html).toContain('<option value="" selected="">Choose</option>');
  });

  test("saved once: one line and a Change button, and no form", () => {
    const html = draw(line({ periodConfirmed: { fy: "2025-26", asOf: "2026-03-31" } }), { fy: "2025-26", asOf: "2026-03-31" });
    expect(html).toContain("Financial year 2025-26, as on 31 Mar 2026");
    expect(html).toContain(">Change<");
    expect(html).not.toContain("Save year");
  });

  test("nothing for a file of sections", () => {
    expect(draw(line({ target: "dies" }))).toBe("");
  });
});

describe("questions panel (3.3, S13)", () => {
  const bundles = (questions: CandidateDetail["questions"]) => detail({ target: "bundles", questions });

  test("a value check: the sentence in words, Skip the rows, the likely unit, and a select of other units, all secondary", () => {
    const html = render(createElement(QuestionsPanel, {
      candidate: bundles([{ code: "magnitude_check", subject: "weightG", params: { field: "weightG", unit: "g", likelyUnit: "kg", side: "above", count: 4, row: 2 }, answer: null, open: true }]),
      act: act(), focusRef, onGoToRow: noop,
    } as never));
    expect(html).toContain("1 question before you approve");
    expect(html).toContain("Some Weight values look wrong for g. 4 rows are much larger than what is usual. They may be in kg. Are they right?");
    expect(html).toContain(">The values are right<");
    expect(html).toContain(">They are in kg<");
    expect(html).toContain(">Skip the rows<");
    expect(html).toContain("They are in another unit");
    expect(html).toContain('href="#row-3"');
    expect(html).toContain("Row 3");
    expect(primaries(html)).toBe(0);
    expect(html).toContain('role="group"');
  });

  test("the year question points at the year line", () => {
    const html = render(createElement(QuestionsPanel, {
      candidate: bundles([{ code: "period_needed", subject: "", params: {}, answer: null, open: true }]), act: act(), focusRef,
    } as never));
    expect(html).toContain("Which financial year is this file from, and on what date?");
    expect(html).toContain("Choose the year");
  });

  test("all answered: the title says so and each answer has a Change button", () => {
    const html = render(createElement(QuestionsPanel, {
      candidate: bundles([{ code: "rates_hidden", subject: "", params: {}, answer: "leave_out", open: false }]), act: act(), focusRef,
    } as never));
    expect(html).toContain("1 question answered");
    expect(html).toContain("Answered: Leave rates out");
    expect(html).toContain(">Change<");
    expect(html).not.toContain("before you approve");
  });

  test("no questions, no panel", () => {
    expect(render(createElement(QuestionsPanel, { candidate: bundles([]), act: act(), focusRef } as never))).toBe("");
  });
});

describe("how orrn read this file (3.3, M10, M11)", () => {
  const plant = () => lib.plantUnitsFor({});
  const model = (c: CandidateDetail, canSeePrices = true, canChange = true) => lib.readPanel(c, plant(), canSeePrices, canChange);

  test("a known layout is one line, collapsed, with Show and Change mapping", () => {
    const recipe = lib.buildRecipe(
      { headers: ["Code", "Minimum weight", "Rate"], headerKey: "k", headerRow: 0, headerRows: 1 } as never,
      "dies",
      [{ id: 1, field: "sectionCode", column: 0, unit: null, dateFormat: "dmy" }, { id: 2, field: "weightMinG", column: 1, unit: "kg/12ft", dateFormat: "dmy" }] as never,
      null,
    );
    const html = render(createElement(ReadPanel, { model: model(detail({ recipe })), onChange: noop } as never));
    expect(html).toContain("How orrn read this file");
    expect(html).toContain("2 columns used, 1 not used.");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Show<");
    expect(html).toContain("Change mapping");
    expect(html).not.toContain("Sample values");
  });

  test("a layout orrn made is open: every column with its kind, samples, field, unit and what orrn stores", () => {
    const recipe = lib.buildRecipe(
      { headers: ["Code", "Minimum weight", "Rate"], headerKey: "k", headerRow: 0, headerRows: 1 } as never,
      "dies",
      [{ id: 1, field: "sectionCode", column: 0, unit: null, dateFormat: "dmy" }, { id: 2, field: "weightMinG", column: 1, unit: "kg/12ft", dateFormat: "dmy" }] as never,
      null,
    );
    const html = render(createElement(ReadPanel, { model: model(detail({ fit: "bot", recipe })), onChange: noop } as never));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Sample values");
    expect(html).toContain("12170, 12171");
    expect(html).toContain("Section code");
    expect(html).toContain("kg per 12 ft");
    expect(html).toContain("Will not import");
    expect(html).toContain("Number");
    expect(html).toContain(">Hide<");
  });

  test("a rate column is Hidden for a person who may not see rates", () => {
    const html = render(createElement(ReadPanel, { model: model(detail({ fit: "bot" }), false), onChange: noop } as never));
    expect(html).toContain("Hidden");
    expect(html).not.toContain("950, 960");
  });

  test("a near fit adds What changed: Renamed, New and Missing with their samples", () => {
    const c = detail({
      state: "needs_confirm", fit: "near", holeName: "My dies",
      fitDiff: { name: "My dies", renamed: [{ old: "Wt", new: "Minimum weight", col: 1 }], extra: [{ header: "Rate", col: 2 }], missing: [{ header: "Alloy", field: "alloy" }] },
    });
    const html = render(createElement(ReadPanel, { model: model(c, true, false), onChange: noop } as never));
    expect(html).toContain("What changed");
    // On a phone the first column is the row's title, so its header shows only in the wide table.
    expect(html).toContain("Column in this file");
    expect(html).toContain("Not in this file");
    for (const word of ["Renamed", "New", "Missing"]) expect(html).toContain(`>${word}<`);
    expect(html).toContain("1.1, 1.2");
    expect(html).not.toContain("Change mapping");
  });
});

describe("mapping editor (3.4, M9)", () => {
  const draw = (c: CandidateDetail, canSeePrices = true) =>
    render(createElement(MappingEditor, { candidate: c, canSeePrices, act: act(), onSaved: noop, onCancel: noop } as never));

  test("a table nobody has named: the target starts at Choose, the layout name is empty, the line says what to do", () => {
    const html = draw(detail({ state: "needs_shape", target: null, fit: "none" }));
    expect(html).toContain(">Map columns<");
    expect(html).toContain("What is this table?");
    expect(html).toContain('<option value="" selected="">Choose</option>');
    expect(html).toContain("Layout name");
    expect(html).toContain('placeholder="For example: Die list from the old system"');
    expect(html).toContain('value=""');
    expect(html).toContain('data-state="choose"');
    expect(html).toContain("Choose what this table is.");
    expect(html).not.toContain("dies.csv");
  });

  test("one card per file column, in file order, with kind, samples, Not used first and a Goes into select", () => {
    const html = draw(detail({ state: "needs_shape", target: "dies", fit: "bot" }));
    expect(html).toContain("Suggested by orrn");
    expect(html).toContain('data-state="needed"');
    expect(html).toContain("Still needed: Series, Section code, Min weight per 12 ft, Max weight per 12 ft.");
    const order = ["Code", "Minimum weight", "Rate"].map((h) => html.indexOf(`>${h}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("12170, 12171");
    expect(html).toContain('aria-label="Goes into: Code"');
    // "Not used" is the first choice of the select, the target's fields follow it.
    expect(html.indexOf(">Not used</option>")).toBeGreaterThan(0);
    expect(html.indexOf(">Not used</option>")).toBeLessThan(html.indexOf("Series (required)"));
    expect(html).toContain("Section code (required)");
    expect(html).toContain("Will not import");
    expect(html).not.toContain("Add field");
  });

  test("a saved layout fills the table: required fields mapped, the unit as a label, the first sample in the plant unit", () => {
    const block = {
      ...detail().block, headers: ["Series", "Code", "Minimum weight", "Maximum weight"], kinds: ["code", "code", "decimal", "decimal"],
      headerKey: "k", sample: [["40", "12170", "1.1", "1.3"]], columnCount: 4,
    };
    const recipe = lib.buildRecipe(
      { headers: block.headers, headerKey: "k", headerRow: 0, headerRows: 1 } as never,
      "dies",
      [
        { id: 1, field: "series", column: 0, unit: null, dateFormat: "dmy" },
        { id: 2, field: "sectionCode", column: 1, unit: null, dateFormat: "dmy" },
        { id: 3, field: "weightMinG", column: 2, unit: "kg/12ft", dateFormat: "dmy" },
        { id: 4, field: "weightMaxG", column: 3, unit: "kg/12ft", dateFormat: "dmy" },
      ] as never,
      null,
    );
    const html = draw(detail({ state: "ready", fit: "manual", holeName: "My dies", recipe, block }));
    expect(html).toContain('value="My dies"');
    expect(html).toContain('data-state="done"');
    expect(html).toContain("All required fields are mapped.");
    expect(html).toContain('aria-label="Unit: Minimum weight"');
    expect(html).toContain('<option value="kg/12ft" selected="">kg per 12 ft</option>');
    expect(html).toContain("1.1");
  });

  test("Save layout is the primary button, Cancel is quiet, and the sticky copy sits above the tab bar", () => {
    const html = draw(detail({ state: "needs_shape", target: null, fit: "none" }));
    expect(html).toContain("Save layout");
    expect(html).toContain("Cancel");
    expect(html).toContain('data-slot="ingest-bar"');
    expect(primaries(html)).toBe(2);
  });

  test("a rate column shows Hidden, never its values, to a person who may not see rates", () => {
    const html = draw(detail({ state: "needs_shape", target: "dies", fit: "bot" }), false);
    expect(html).toContain("Hidden");
    expect(html).not.toContain("950, 960");
  });
});

describe("rows (3.3, M1, M12, S1)", () => {
  const staged = (over: Partial<StagedRowView>): StagedRowView => ({
    id: "r1", rowIndex: 2, state: "ready_create", values: { legacyId: "L1", weightG: 58400 }, entered: { weightG: { text: "58,400", unit: "g" } },
    raw: ["L1", "58400"], reasons: [], matchId: null, options: [], diff: null, decision: null, mergeState: "open", committedType: null,
    committedId: null, rate: null, rateHidden: false, ...over,
  });
  const bundlesCandidate = (over: Partial<CandidateDetail> = {}) => detail({ target: "bundles", counts: counts({ total: 3, create: 3 }), ...over });
  const stageRows = (c: CandidateDetail, state: string, page: number, size: number, items: StagedRowView[]): Seed => [
    lib.ingestKeys.rows(c.id, state as never, page, size), { items, hasNext: false },
  ];
  const draw = (c: CandidateDetail, seeds: Seed[], canDecide = true) =>
    render(createElement(rows.StagedRows, { candidate: c, canDecide, act: act(), focusRef, announce: noop } as never), seeds);

  test("a ready row needs no control: values in the plant unit, the file's own value only because its unit differs, Skip in a menu", () => {
    const c = bundlesCandidate();
    const html = draw(c, [stageRows(c, "all", 0, lib.ROWS_UI_PAGE, [staged({})])]);
    expect(html).toContain("Row 3");
    expect(html).toContain(">58.4<");
    expect(html).toContain(">kg<");
    expect(html).toContain("File said");
    expect(html).toContain("58,400 g");
    expect(html).not.toContain('role="group" aria-label="Decide');
    expect(html).toContain('aria-label="More for Row 3"');
    expect(html).toContain("New");
    expect(html).not.toContain("Previous page");
  });

  test("the file's value is left out when the unit is the same", () => {
    const c = bundlesCandidate();
    const html = draw(c, [stageRows(c, "all", 0, lib.ROWS_UI_PAGE, [staged({ entered: { weightG: { text: "58.4", unit: "kg" } } })])]);
    expect(html).toContain(">58.4<");
    expect(html).not.toContain("File said");
  });

  test("a row that needs a decision: an amber edge, its reason, inline buttons named with the row, no select", () => {
    const c = bundlesCandidate({ counts: counts({ total: 3, create: 1, ambiguous: 1, conflict: 1 }) });
    const ambiguous = staged({ id: "r3", rowIndex: 2, state: "ambiguous", reasons: ["ambiguous:legacyId"], options: [{ id: "L1", label: "RCQCZ1" }, { id: "L2", label: "RCQCZ2" }] });
    const conflict = staged({ id: "r5", rowIndex: 4, state: "conflict", diff: { weightG: { live: "58", file: "59" } } });
    const html = draw(c, [
      stageRows(c, "ambiguous", 0, lib.NEEDS_DECISION_WINDOW, [ambiguous]),
      stageRows(c, "conflict", 0, lib.NEEDS_DECISION_WINDOW, [conflict]),
    ]);
    expect(html).toContain("Needs a decision 2");
    expect(html).toContain('data-needs-decision="true"');
    expect(html).toContain("border-l-[3px]");
    expect(html).toContain('role="group" aria-label="Decide: row 3"');
    expect(html).toContain('aria-label="Use RCQCZ1, row 3"');
    expect(html).toContain('aria-label="Add as new, row 3"');
    expect(html).toContain('aria-label="Skip this row, row 3"');
    expect(html).toContain('aria-label="Keep the orrn value, row 5"');
    expect(html).toContain('aria-label="Use the file value, row 5"');
    expect(html).toContain("Old bundle number matches more than one record. Pick one.");
    expect(html).not.toContain("<select");
    expect(primaries(html)).toBe(0);
  });

  test("without permission to decide, no row has a control", () => {
    const c = bundlesCandidate({ counts: counts({ total: 3, create: 1, ambiguous: 1 }) });
    const html = draw(c, [stageRows(c, "ambiguous", 0, lib.NEEDS_DECISION_WINDOW, [staged({ id: "r3", state: "ambiguous", options: [] })]), stageRows(c, "conflict", 0, lib.NEEDS_DECISION_WINDOW, [])], false);
    expect(html).not.toContain('role="group" aria-label="Decide');
    expect(html).not.toContain("More for Row");
  });

  test("more than five fields fold behind Show all fields", () => {
    const c = detail({ target: "dies", counts: counts({ total: 1, create: 1 }) });
    const values = { series: "S", sectionCode: "12170", weightMinG: 1100, weightMaxG: 1200, widthMm: 40, thicknessMm: 2, legMm: 10 };
    const html = draw(c, [stageRows(c, "all", 0, lib.ROWS_UI_PAGE, [staged({ values, entered: null })])]);
    expect(html).toContain("Show all fields");
    expect(html).toContain('aria-expanded="false"');
  });

  test("the table: one column per field with the plant unit in the header, numbers right aligned, a decision column only when a row needs one", () => {
    const plant = lib.plantUnitsFor({});
    const c = bundlesCandidate({ counts: counts({ total: 2, create: 1, ambiguous: 1 }) });
    const views = [
      lib.rowView(c, staged({ id: "r1", rowIndex: 0 }), plant),
      lib.rowView(c, staged({ id: "r2", rowIndex: 1, state: "ambiguous", options: [{ id: "L1", label: "RCQCZ1" }] }), plant),
    ];
    const table = lib.rowsTable(c, views, plant);
    const html = render(createElement(rows.RowsTable, {
      views, columns: table.columns, showChoice: true, decisionColumn: table.decisionColumn, canDecide: true, act: act(), focusRef, onDecide: noop,
    } as never));
    expect(html).toContain("Weight, kg");
    expect(html).toContain("Your choice");
    expect(html).toContain('data-testid="needs-decision-mark"');
    expect(html).toContain('aria-label="Use RCQCZ1, row 2"');
    // The ready row has no decision buttons.
    expect(html).not.toContain('aria-label="Decide: row 1"');
    const noDecision = lib.rowsTable(c, [views[0]!], plant);
    expect(noDecision.decisionColumn).toBe(false);
  });

  test("a rate is Hidden, with no unit and no file line, when the person may not see rates", () => {
    const plant = lib.plantUnitsFor({});
    const c = detail({ target: "orders", counts: counts({ total: 1, create: 1 }) });
    const view = lib.rowView(c, staged({ values: { poNumber: "PO1", rate: null }, entered: null, rateHidden: true }), plant);
    const table = lib.rowsTable(c, [view], plant);
    const html = render(createElement(rows.RowsTable, {
      views: [view], columns: table.columns, showChoice: false, decisionColumn: false, canDecide: true, act: act(), focusRef, onDecide: noop,
    } as never));
    expect(html).toContain("Hidden");
    expect(html).not.toContain("File said");
  });
});

// A state list the tests above must keep covering: every state of an import has a bar.
test("every state of an import draws a bar", () => {
  const states: CandidateState[] = ["processing", "needs_confirm", "needs_shape", "ready", "held", "approved", "merging", "merged", "failed", "discarded"];
  for (const state of states) {
    const html = card(detail({ state }));
    expect(html).toContain(`data-state="${state}"`);
  }
});
