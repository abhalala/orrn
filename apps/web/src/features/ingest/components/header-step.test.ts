import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type ViteDevServer } from "vite";

import type { HeaderAskView } from "../lib/header-step";

let server: ViteDevServer;
let createElement: typeof import("react").createElement;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let HeaderStep: typeof import("./header-step").HeaderStep;
let columnLetter: typeof import("./header-step").columnLetter;

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
  createElement = (await import("react")).createElement;
  renderToStaticMarkup = (await import("react-dom/server")).renderToStaticMarkup;
  const query = await import("@tanstack/react-query");
  QueryClient = query.QueryClient;
  QueryClientProvider = query.QueryClientProvider;
  const i18n = await server.ssrLoadModule("@orrn/i18n");
  await i18n.loadMessages("en");
  const mod = await server.ssrLoadModule("/src/features/ingest/components/header-step.tsx");
  HeaderStep = mod.HeaderStep;
  columnLetter = mod.columnLetter;
}, 30_000);

afterAll(async () => {
  await server?.close();
});

const view = (over: Partial<HeaderAskView> = {}): HeaderAskView => ({
  position: 1, total: 1, sheetName: "Baki", columns: 3, rowCount: 120,
  lines: [
    { row: 0, n: 1, cells: ["PENDING ORDERS"], gapBefore: false },
    { row: 1, n: 2, cells: ["Plant 2"], gapBefore: false },
    { row: 5, n: 6, cells: ["Party", "Order", "Kg"], gapBefore: true },
    { row: 6, n: 7, cells: ["Shree", "41", "120"], gapBefore: false },
  ],
  preselected: { headerRow: 5, headerRows: 1 }, resembles: null, offers: [], hintError: false, attempt: 1,
  ...over,
});
const render = (v: HeaderAskView) =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(HeaderStep, { view: v, fileName: "baki.xlsx", onReply: () => undefined })),
  );

describe("the header step", () => {
  test("asks the question over the first rows, with their row numbers and the guess selected", () => {
    const html = render(view());
    expect(html).toContain("Which row has the column names?");
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    // Only the guessed row is checked, and it is row 6.
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="Row 6: Party, Order, Kg"[^>]*>|checked=""[^>]*aria-label="Row 6/);
    expect(html).toContain("Use row 6");
    expect(html).toContain("Do not import this table");
  });

  test("a gap in the row numbers is drawn as a gap", () => {
    const html = render(view());
    expect(html.match(/data-testid="header-gap"/g)).toHaveLength(1);
    expect(html).toContain("Rows left out");
    expect(render(view({ lines: view().lines.slice(0, 2), preselected: { headerRow: 0, headerRows: 1 } }))).not.toContain("header-gap");
  });

  test("the line that names a layout it looks like, and the count of tables waiting", () => {
    const html = render(view({ resembles: { name: "dies", n: 6, rows: 1 }, position: 2, total: 3 }));
    expect(html).toContain("Is row 6 the column names?");
    expect(html).toContain("Table 2 of 3");
    expect(render(view())).not.toContain("Is row");
    expect(render(view())).not.toContain("Table 1 of");
  });

  test("the offers to join come first, then the rows", () => {
    const html = render(view({ offers: ["continues", "same"] }));
    expect(html.indexOf("It continues the table above")).toBeGreaterThan(0);
    expect(html.indexOf("Same columns as the table above")).toBeGreaterThan(html.indexOf("It continues the table above"));
    expect(html.indexOf("It continues the table above")).toBeLessThan(html.indexOf('role="radiogroup"'));
    expect(render(view())).not.toContain("It continues");
  });

  test("a pick that could not be followed says so", () => {
    expect(render(view({ hintError: true }))).toContain('role="alert"');
    expect(render(view({ hintError: true }))).toContain("Pick another row");
    expect(render(view())).not.toContain("Pick another row");
  });

  test("one or two header rows are offered when the row has another under it", () => {
    expect(render(view())).toContain("Two rows");
    const last = view({ lines: [{ row: 0, n: 1, cells: ["Only"], gapBefore: false }], preselected: { headerRow: 0, headerRows: 1 } });
    expect(render(last)).not.toContain("Two rows");
  });

  // Design check M3: phone targets, a cue for the columns a phone leaves out, no word cut in two.
  test("the row radios are 44 px targets on touch screens and the whole row picks the row", () => {
    const html = render(view());
    expect(html).toContain("pointer-coarse:min-h-11");
    expect(html.match(/<tr class="[^"]*align-top/g)).toHaveLength(4);
  });

  test("columns from D on are left out on a phone and said so; the wide screen says its own count", () => {
    const wide = render(view({ columns: 9 }));
    expect(wide).toContain('data-testid="more-columns-narrow"');
    expect(wide).toContain("6 more columns not shown");
    expect(wide).toContain('data-testid="more-columns"');
    expect(wide).toContain("3 more columns not shown");
    // Three columns fit a phone: nothing to say.
    expect(render(view({ columns: 3 }))).not.toContain("more-columns");
    // Four columns: a phone leaves one out, a wide screen none.
    const four = render(view({ columns: 4 }));
    expect(four).toContain('data-testid="more-columns-narrow"');
    expect(four).toContain("1 more column not shown");
    expect(four).not.toContain('data-testid="more-columns"');
  });

  test("a word is never cut in the preview: no break-words, the table scrolls inside its box", () => {
    const html = render(view());
    expect(html).not.toMatch(/<td[^>]*break-words/);
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("max-sm:whitespace-nowrap");
  });

  test("column letters run A to Z, then AA", () => {
    expect([columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(27)]).toEqual(["A", "Z", "AA", "AB"]);
  });
});
