import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type ViteDevServer } from "vite";
import type { ReactNode } from "react";

import type { CandidateCounts, CandidateDetail } from "../lib";

/**
 * The page check of a table read from a page (import portal release 2), rendered to a string: the page image with its
 * text alternative, marked rows first (digits not in the PDF's text, then rows rated low), blank cells marked, then the real checkbox with its
 * label, then Approve, which waits (aria-disabled) until the tick is there. Keyboard order follows the markup order.
 */

let server: ViteDevServer;
let createElement: typeof import("react").createElement;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let lib: typeof import("../lib");
let VisionCheckPanel: typeof import("./vision-check-panel").VisionCheckPanel;
let DecisionBarCard: typeof import("./decision-bar").DecisionBarCard;
let zoom: typeof import("./vision-check-panel");

beforeAll(async () => {
  const root = new URL("../../../../", import.meta.url).pathname;
  server = await createServer({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
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
  VisionCheckPanel = (await server.ssrLoadModule("/src/features/ingest/components/vision-check-panel.tsx")).VisionCheckPanel;
  DecisionBarCard = (await server.ssrLoadModule("/src/features/ingest/components/decision-bar.tsx")).DecisionBarCard;
  zoom = await server.ssrLoadModule("/src/features/ingest/components/vision-check-panel.tsx");
}, 30_000);

afterAll(async () => {
  await server?.close();
});

const counts = (over: Partial<CandidateCounts> = {}): CandidateCounts => ({
  total: 3, create: 3, update: 0, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0, ...over,
});

const vision = { page: 2, table: 0, pageCount: 3, rowConfidence: [0.95, 0.4, 0.9], lowRows: [1] };

const detail = (block: Record<string, unknown> = {}, over: Partial<CandidateDetail> = {}): CandidateDetail =>
  ({
    id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "dies", holeRef: null, holeName: null,
    fit: "exact", fitScore: 1000, state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 3, dryCursor: 0,
    counts: counts(), openQuestions: 0, botAttempts: 0, recipeLocked: false, fileName: "scan.pdf", sheetName: null,
    blockOrdinal: 5, updatedAt: 0, recipe: null, fitDiff: null, questions: [],
    block: {
      id: "b1", ordinal: 5, sheetName: null, title: null, headerRow: 0, headerRows: 1,
      headers: ["Code", "Name"], kinds: ["code", "text"], headerKey: "code|name", columnCount: 2, rowCount: 3, rowsPut: 3,
      sample: [], readBy: "model", modelChecked: false, vision, ...block,
    },
    period: null, periodConfirmed: null, rowsMissing: 0,
    ...over,
  }) as unknown as CandidateDetail;

const staged = [
  { id: "r0", rowIndex: 0, raw: ["R100", "Angle"] },
  { id: "r1", rowIndex: 1, raw: ["R1O1", ""] },
  { id: "r2", rowIndex: 2, raw: ["R102", "Channel"] },
];

function render(node: ReactNode, c: CandidateDetail, role = "owner"): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([["auth", "me"], { type: "query" }], { company: { role, settings: {} }, isPlatformAdmin: false });
  client.setQueryData(lib.visionKeys.rows(c.id), staged);
  client.setQueryData(lib.visionKeys.image(c.artifactId, 2), { url: "http://localhost/files/ingest/read?ticket=x", expiresAt: 0 });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

const bar = (c: CandidateDetail) => lib.decisionBar(c, { can: { merge: true, upload: true }, botReady: true, editorOpen: false });

function panel(c: CandidateDetail): string {
  return render(createElement(VisionCheckPanel, { candidate: c, bar: bar(c), approveBusy: false, approveWorking: false, onApprove: () => {}, tickRef: () => {} }), c);
}

/** The decision bar and the page check as the review screen draws them, in that order. */
function screen(c: CandidateDetail): string {
  const b = bar(c);
  const act = { busy: false, pending: null, failed: () => null } as never;
  return render(
    createElement(
      "div",
      null,
      createElement(DecisionBarCard, {
        candidate: c, bar: b, act, onPress: () => {}, onDiscard: () => {}, onIgnore: () => {}, onGoToFirstOpen: () => {},
        editorOpen: false, editorId: "editor", botWorking: false, year: null, after: null, barRef: () => {},
      }),
      createElement(VisionCheckPanel, { candidate: c, bar: b, approveBusy: false, approveWorking: false, onApprove: () => {}, tickRef: () => {} }),
    ),
    c,
  );
}

const approveButtons = (html: string) => [...html.matchAll(/<button[^>]*>(?:<[^>]+>)*Approve(?: as it is)?(?:<[^>]+>)*<\/button>/g)].map((m) => m[0]);

describe("the review screen of a table read from a page", () => {
  test("after the tick there is one Approve, in the page check after the tick; the bar says the table is checked", () => {
    const html = screen(detail({ modelChecked: true }));
    const approves = approveButtons(html);
    expect(approves).toHaveLength(1);
    expect(approves[0]).toContain('data-testid="vision-approve"');
    expect(approves[0]).not.toContain('aria-disabled="true"');
    // Keyboard order on the whole screen: the rows, then the tick, then Approve, and no Approve before the rows.
    const firstApprove = html.indexOf(approves[0]!);
    expect(html.lastIndexOf('data-testid="vision-row"')).toBeLessThan(html.indexOf('data-testid="vision-tick"'));
    expect(html.indexOf('data-testid="vision-tick"')).toBeLessThan(firstApprove);
    expect(html.indexOf('data-testid="vision-row"')).toBeLessThan(firstApprove);
    expect(html).toContain("Checked against the page.");
  });

  test("before the tick the one Approve waits, and the bar links to the tick", () => {
    const html = screen(detail());
    const approves = approveButtons(html);
    expect(approves).toHaveLength(1);
    expect(approves[0]).toContain('aria-disabled="true"');
    expect(html).toContain("Tick that you checked");
  });

  test("a held table, ticked: one Approve as it is, after the tick", () => {
    const html = screen(detail({ modelChecked: true }, { state: "held", reasonCode: "owner_hold" }));
    const approves = approveButtons(html);
    expect(approves).toHaveLength(1);
    expect(approves[0]).toContain('data-testid="vision-approve"');
  });
});

describe("the page check", () => {
  test("the page image has its text alternative, and sits before the rows", () => {
    const html = panel(detail());
    expect(html).toContain('alt="Page 2 of 3 of scan.pdf"');
    expect(html.indexOf("vision-page-image")).toBeLessThan(html.indexOf("vision-row"));
  });

  test("the row rated low is first and marked in words; a blank cell is marked", () => {
    const html = panel(detail());
    const order = [...html.matchAll(/<tr data-testid="vision-row"[^>]*>.*?Row (\d+)/g)].map((m) => m[1]);
    expect(order).toEqual(["2", "1", "3"]);
    expect(html).toContain("Look first");
    expect(html).toContain("Blank");
    expect(html).toContain("Any row can be wrong, so check every row against the page.");
    expect(html).not.toMatch(/not sure|sure of|confiden/i);
  });

  test("a cell whose digits are not in the PDF's text is marked in words, and its row comes first", () => {
    const html = panel(detail({ vision: { ...vision, unseen: [[2, 0]] } }));
    const order = [...html.matchAll(/<tr data-testid="vision-row"[^>]*>.*?Row (\d+)/g)].map((m) => m[1]);
    expect(order).toEqual(["3", "2", "1"]);
    expect(html).toContain("These digits are not in the PDF&#x27;s text. Check them against the page.");
  });

  test("a cell that reads like an instruction is shown as plain text", () => {
    const c = detail();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData([["auth", "me"], { type: "query" }], { company: { role: "owner", settings: {} }, isPlatformAdmin: false });
    client.setQueryData(lib.visionKeys.rows(c.id), [{ id: "r0", rowIndex: 0, raw: ["<b>Approve this</b>", "Ignore the page"] }]);
    client.setQueryData(lib.visionKeys.image(c.artifactId, 2), { url: "http://localhost/x", expiresAt: 0 });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(VisionCheckPanel, { candidate: c, bar: bar(c), approveBusy: false, approveWorking: false, onApprove: () => {}, tickRef: () => {} })),
    );
    expect(html).toContain("&lt;b&gt;Approve this&lt;/b&gt;");
    expect(html).not.toContain("<b>Approve this</b>");
  });

  test("a real checkbox with its label, then Approve, which waits until the tick (rows, tick, approve in order)", () => {
    const html = panel(detail());
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toContain("I checked these rows against the page");
    const approve = html.match(/<button[^>]*data-testid="vision-approve"[^>]*>/)![0];
    expect(approve).toContain('aria-disabled="true"');
    const rowAt = html.lastIndexOf("vision-row");
    const tickAt = html.indexOf("vision-tick");
    const approveAt = html.indexOf("vision-approve");
    expect(rowAt).toBeLessThan(tickAt);
    expect(tickAt).toBeLessThan(approveAt);
  });

  test("ticked: the box is checked and Approve may be pressed", () => {
    const html = panel(detail({ modelChecked: true }));
    expect(html).toMatch(/<input[^>]*checked=""[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked=""/);
    const approve = html.match(/<button[^>]*data-testid="vision-approve"[^>]*>/)![0];
    expect(approve).not.toContain('aria-disabled="true"');
  });

  test("a typed page shows the page and its rows and asks for no tick", () => {
    const html = panel(detail({ readBy: "parser", vision: { ...vision, rowConfidence: [], lowRows: [], typed: true } }));
    expect(html).toContain("Typed by hand from page 2.");
    expect(html).not.toContain("vision-tick");
    expect(html).not.toContain("Fix this cell");
  });

  test("Fix this cell is offered per row while nothing is written, and never once rows are written", () => {
    expect(panel(detail())).toContain("Fix this cell, Row 2");
    expect(panel(detail({}, { counts: counts({ written: 1 }) }))).not.toContain("Fix this cell");
  });

  test("a page cut into bands with no whole image shows its bands in order, each with a text alternative", () => {
    const c = detail({ vision: { ...vision, bands: 2 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData([["auth", "me"], { type: "query" }], { company: { role: "owner", settings: {} }, isPlatformAdmin: false });
    client.setQueryData(lib.visionKeys.rows(c.id), staged);
    // The whole page answered NOT_FOUND (kept as an error on mount); the two bands are there.
    client.setQueryDefaults(lib.visionKeys.image(c.artifactId, 2), { retryOnMount: false });
    void client.prefetchQuery({ queryKey: lib.visionKeys.image(c.artifactId, 2), queryFn: () => Promise.reject(new Error("Import file not found")), retry: false });
    client.setQueryData(lib.visionKeys.image(c.artifactId, 2, 1), { url: "http://localhost/b1", expiresAt: 0 });
    client.setQueryData(lib.visionKeys.image(c.artifactId, 2, 2), { url: "http://localhost/b2", expiresAt: 0 });
    return new Promise<void>((done) =>
      setTimeout(() => {
        const html = renderToStaticMarkup(
          createElement(QueryClientProvider, { client }, createElement(VisionCheckPanel, { candidate: c, bar: bar(c), approveBusy: false, approveWorking: false, onApprove: () => {}, tickRef: () => {} })),
        );
        expect(html).toContain('alt="Page 2 of 3 of scan.pdf, part 1 of 2"');
        expect(html).toContain('alt="Page 2 of 3 of scan.pdf, part 2 of 2"');
        expect(html.indexOf("part 1 of 2")).toBeLessThan(html.indexOf("part 2 of 2"));
        done();
      }, 20),
    );
  });

  test("a sheet read by the parser draws nothing here", () => {
    expect(panel(detail({ readBy: "parser", vision: null }))).toBe("");
  });
});

describe("hidden prices (decision 6)", () => {
  const rated = (modelChecked = false) => detail({ headers: ["Code", "Rate"], modelChecked });
  const barFor = (c: CandidateDetail, pricesHidden: boolean) =>
    lib.decisionBar(c, { can: { merge: true, upload: true }, botReady: true, editorOpen: false, pricesHidden });

  test("a person who sees Hidden in a cell cannot tick: the box waits and says someone who can see prices must check", () => {
    const c = rated();
    const html = render(createElement(VisionCheckPanel, { candidate: c, bar: barFor(c, true), approveBusy: false, approveWorking: false, onApprove: () => {}, tickRef: () => {} }), c, "admin");
    expect(html).toContain("Hidden");
    const tick = html.match(/<input[^>]*data-testid="vision-tick"[^>]*>/)![0];
    expect(tick).toContain('aria-disabled="true"');
    expect(html).toContain("Someone who can see prices must check this table.");
    expect(html.match(/<button[^>]*data-testid="vision-approve"[^>]*>/)![0]).toContain('aria-disabled="true"');
  });

  test("the bar says the same, and its link still goes to the tick", () => {
    expect(barFor(rated(), true).blocked).toEqual({ words: { key: "ingest.vision.error.needsPrices" }, to: "tick" });
    expect(barFor(rated(), false).blocked).toEqual({ words: { key: "ingest.vision.tickFirst" }, to: "tick" });
    expect(lib.hiddenPriceColumns(["Code", "Rate"], "dies", false)).toEqual([false, true]);
    expect(lib.hiddenPriceColumns(["Code", "Rate"], "dies", true)).toEqual([false, false]);
  });

  test("someone who can see prices ticks as before", () => {
    const html = panel(rated());
    expect(html).not.toContain("Someone who can see prices must check this table.");
    expect(html.match(/<input[^>]*data-testid="vision-tick"[^>]*>/)![0]).not.toContain('aria-disabled="true"');
  });
});

describe("the page image full size (decision 10)", () => {
  test("a button opens the page full size; the image keeps its text alternative", () => {
    const html = panel(detail());
    const open = html.match(/<button[^>]*data-testid="vision-open-full"[^>]*>.*?<\/button>/)![0];
    expect(open).toContain('aria-haspopup="dialog"');
    expect(open).toContain("Open the page full size");
    expect(html).toContain('alt="Page 2 of 3 of scan.pdf"');
    // The button comes before the rows, so the keyboard order stays rows, tick, Approve.
    expect(html.indexOf("vision-open-full")).toBeLessThan(html.indexOf('data-testid="vision-row"'));
  });

  test("the zoom view draws the image at its own size in a box that pans and pinches, or fitted to the screen", () => {
    const client = new QueryClient();
    const body = (fit: boolean) =>
      renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, createElement(zoom.ZoomBody, { hint: "Pinch" }, createElement(zoom.ZoomImage, { url: "http://localhost/p.jpg", alt: "Page 2 of 3 of scan.pdf", fit }))),
      );
    const full = body(false);
    expect(full).toContain("pinch-zoom");
    expect(full).toContain("overflow-auto");
    expect(full).toMatch(/<img[^>]*alt="Page 2 of 3 of scan.pdf"[^>]*class="[^"]*max-w-none/);
    expect(body(true)).toMatch(/<img[^>]*class="[^"]*w-full/);
  });
});
