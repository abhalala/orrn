import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type ViteDevServer } from "vite";
import type { ReactNode } from "react";

import type { CandidateCounts, CandidateDetail } from "../lib";

/**
 * The page check of a table read from a page (import portal release 2), rendered to a string: the page image with its
 * text alternative, rows the model was not sure of first and marked, blank cells marked, then the real checkbox with its
 * label, then Approve, which waits (aria-disabled) until the tick is there. Keyboard order follows the markup order.
 */

let server: ViteDevServer;
let createElement: typeof import("react").createElement;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let lib: typeof import("../lib");
let VisionCheckPanel: typeof import("./vision-check-panel").VisionCheckPanel;

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

describe("the page check", () => {
  test("the page image has its text alternative, and sits before the rows", () => {
    const html = panel(detail());
    expect(html).toContain('alt="Page 2 of 3 of scan.pdf"');
    expect(html.indexOf("vision-page-image")).toBeLessThan(html.indexOf("vision-row"));
  });

  test("the row the model was not sure of is first and marked in words; a blank cell is marked", () => {
    const html = panel(detail());
    const order = [...html.matchAll(/<tr data-testid="vision-row"[^>]*>.*?Row (\d+)/g)].map((m) => m[1]);
    expect(order).toEqual(["2", "1", "3"]);
    expect(html).toContain("Not sure");
    expect(html).toContain("Blank");
    expect(html).toContain("Rows the model was not sure of come first.");
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

  test("a sheet read by the parser draws nothing here", () => {
    expect(panel(detail({ readBy: "parser", vision: null }))).toBe("");
  });
});
