import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";
import type { ReactNode } from "react";

import type { CandidateCounts, CandidateDetail } from "../lib";

/**
 * Item 16 (owner decision "Price-viewers tick, admin approves"), on the screen. `ingest.check` (admin, office, manager,
 * accountant; the owner holds every action) shows the tick of a model-read table; a price column also takes
 * `order.price`. A price viewer (office, manager, accountant) sees the list of tables waiting for a check and the read-only
 * page check, and nothing else of the import screens: no Approve, no upload, no discard, no files or merge page.
 */

let server: ViteDevServer;
let createElement: typeof import("react").createElement;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let lib: typeof import("../lib");
let VisionCheckPanel: typeof import("./vision-check-panel").VisionCheckPanel;
let screens: typeof import("./check-screens");
let IngestAccess: typeof import("./shared").IngestAccess;
let nav: typeof import("../../../shell/nav-items");

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
  IngestAccess = (await server.ssrLoadModule("/src/features/ingest/components/shared.tsx")).IngestAccess;
  nav = await server.ssrLoadModule("/src/shell/nav-items.ts");
  // Loaded last and on its own, so a test that does not need these screens still runs without them.
  screens = (await server.ssrLoadModule("/src/features/ingest/components/check-screens.tsx").catch(() => ({}))) as typeof screens;
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
const meOf = (role: string) => ({ company: { role, settings: {} }, isPlatformAdmin: false, platformRole: null });

function render(node: ReactNode, role: string, c: CandidateDetail = detail(), extra?: (client: InstanceType<typeof QueryClient>) => void): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData([["auth", "me"], { type: "query" }], meOf(role));
  client.setQueryData(lib.visionKeys.rows(c.id), staged);
  client.setQueryData(lib.visionKeys.image(c.artifactId, 2), { url: "http://localhost/files/ingest/read?ticket=x", expiresAt: 0 });
  extra?.(client);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

/** The page check as the full review draws it for this role (its bar may carry Approve). */
function panelAs(role: string, c: CandidateDetail): string {
  const merge = role === "owner" || role === "admin";
  const pricesHidden = lib.hiddenPriceColumns(c.block.headers, c.target, ["owner", "office", "manager", "accountant"].includes(role)).some(Boolean);
  const bar = lib.decisionBar(c, { can: { merge, upload: merge }, botReady: true, editorOpen: false, pricesHidden });
  return render(createElement(VisionCheckPanel, { candidate: c, bar, approveBusy: false, approveWorking: false, onApprove: () => {}, tickRef: () => {} }), role, c);
}

/** "absent", "refused" (in the tab order but aria-disabled, prices hidden) or "allowed". */
function tickOf(html: string): "absent" | "refused" | "allowed" {
  const tick = html.match(/<input[^>]*data-testid="vision-tick"[^>]*>/)?.[0];
  if (!tick) return "absent";
  return tick.includes('aria-disabled="true"') ? "refused" : "allowed";
}

const approves = (html: string) => (html.match(/data-testid="vision-approve"/g) ?? []).length;

describe("who sees the tick (item 16)", () => {
  const ROLES = ["owner", "admin", "office", "manager", "accountant", "supervisor", "packer", "viewer"];
  const NO_PRICE = { owner: "allowed", admin: "allowed", office: "allowed", manager: "allowed", accountant: "allowed", supervisor: "absent", packer: "absent", viewer: "absent" };
  // The admin holds ingest.check but not order.price: the box waits and says someone who can see prices must check.
  const PRICED = { ...NO_PRICE, admin: "refused" };

  for (const [name, headers, expected] of [["no price column", ["Code", "Name"], NO_PRICE], ["a price column", ["Code", "Rate"], PRICED]] as const) {
    test(`a table with ${name}: the tick per role`, () => {
      const c = detail({ headers });
      const got = Object.fromEntries(ROLES.map((role) => [role, tickOf(panelAs(role, c))]));
      expect(got).toEqual(expected);
    });
  }

  test("a price viewer sees no Approve and no Fix this cell in the page check; the admin and owner keep Approve", () => {
    const c = detail({ modelChecked: true });
    for (const role of ["office", "manager", "accountant"]) {
      const html = panelAs(role, c);
      expect({ role, approves: approves(html), fix: html.includes("Fix this cell") }).toEqual({ role, approves: 0, fix: false });
    }
    expect(approves(panelAs("admin", c))).toBe(1);
    expect(approves(panelAs("owner", c))).toBe(1);
  });
});

describe("the admin approves a priced table a price viewer ticked (item 16)", () => {
  test("ticked by someone else, prices hidden from the admin: one Approve that may be pressed, and the bar is not blocked", () => {
    const c = detail({ headers: ["Code", "Rate"], modelChecked: true, modelCheckedBy: "u7", modelCheckedAt: Date.UTC(2026, 10, 20, 8, 35) });
    const html = panelAs("admin", c);
    const approve = html.match(/<button[^>]*data-testid="vision-approve"[^>]*>/g) ?? [];
    expect(approve).toHaveLength(1);
    expect(approve[0]).not.toContain('aria-disabled="true"');
    expect(html.match(/<input[^>]*data-testid="vision-tick"[^>]*>/)![0]).toContain("checked");
    expect(html).toContain('data-testid="vision-checked-by"');
    const bar = lib.decisionBar(c, { can: { merge: true, upload: true }, botReady: true, editorOpen: false, pricesHidden: true });
    expect(bar.blocked).toBeNull();
  });
});

describe("which import screens a person gets (item 16)", () => {
  test("upload or merge: every screen; ingest.check only: the check screens; neither: none", () => {
    const got = Object.fromEntries(["owner", "admin", "office", "manager", "accountant", "supervisor", "viewer"].map((r) => [r, lib.ingestAccessOf(meOf(r) as never)]));
    expect(got).toEqual({ owner: "full", admin: "full", office: "check", manager: "check", accountant: "check", supervisor: "none", viewer: "none" });
  });

  test("Imports is in the menu of the price viewers, not of a role without ingest.check", () => {
    const has = (role: string) => nav.visibleItems(nav.TENANT_MORE, meOf(role) as never).some((i) => i.key === "ingest");
    expect(["office", "manager", "accountant", "admin", "supervisor", "viewer"].map((r) => [r, has(r)])).toEqual([
      ["office", true], ["manager", true], ["accountant", true], ["admin", true], ["supervisor", false], ["viewer", false],
    ]);
  });

  test("the upload, files and merge screens stay behind upload or merge: a price viewer gets no access there", () => {
    const html = render(createElement(IngestAccess, null, createElement("p", null, "upload screen")), "office");
    expect(html).not.toContain("upload screen");
    expect(render(createElement(IngestAccess, null, createElement("p", null, "upload screen")), "admin")).toContain("upload screen");
    const src = (path: string) => readFileSync(new URL(`../../../routes/_tenant/${path}`, import.meta.url), "utf8");
    for (const path of ["ingest.files.$artifactId.tsx", "ingest.merge.$runId.tsx"]) {
      expect({ path, gated: /<IngestAccess>/.test(src(path)), check: src(path).includes("ingest.check") || src(path).includes("ingestAccessOf") }).toEqual({ path, gated: true, check: false });
    }
    // The Imports page and a review send a check-only person to the check screens, everyone else as before.
    for (const path of ["ingest.index.tsx", "ingest.review.$candidateId.tsx"]) {
      expect({ path, routed: /ingestAccessOf\(me\) === "check"/.test(src(path)), gated: /<IngestAccess>/.test(src(path)) }).toEqual({ path, routed: true, gated: true });
    }
  });

  test("the check-only review: the page check and its tick, with no Approve, discard, hold, mapping or upload", () => {
    const c = detail({ modelChecked: true, modelCheckedBy: "u7", modelCheckedAt: Date.UTC(2026, 10, 20, 8, 35) });
    const html = render(createElement(screens.CheckReviewBody, { candidate: c }), "office", c, (client) =>
      client.setQueryData([["company", "membersList"], { type: "query" }], [{ userId: "u7", user: { name: "Asha Patel", email: "asha@example.test" } }]),
    );
    expect(html).toContain('data-testid="vision-check"');
    expect(tickOf(html)).toBe("allowed");
    expect(html).toContain("Check each row against the page, then tick. The admin approves the table.");
    expect(html).toMatch(/Checked by Asha Patel on .+ at .+\./);
    for (const word of ["Approve", "Discard", "Hold", "Fix this cell", "Change the layout", "Add files"]) expect({ word, shown: html.includes(word) }).toEqual({ word, shown: false });
  });

  test("a table not read from a page is not opened on the check-only review", () => {
    const c = detail({ readBy: "parser", vision: undefined });
    const html = render(createElement(screens.CheckReviewBody, { candidate: c }), "office", c);
    expect(html).not.toContain('data-testid="vision-check"');
  });
});

describe("tables waiting for a check (item 16)", () => {
  const items = [
    { candidateId: "c1", artifactId: "a1", fileName: "slip.jpg", title: null, page: 1, pageCount: 2, rows: 4, needsPrices: false },
    { candidateId: "c2", artifactId: "a1", fileName: "slip.jpg", title: "Rates", page: 2, pageCount: 2, rows: 1, needsPrices: true },
  ];

  test("each table links to its review, with its page and rows; a table this person cannot tick says why", () => {
    const html = render(createElement(screens.VisionWaitingList, { items, alwaysShow: true }), "admin");
    expect(html).toContain("Tables waiting for a check");
    expect((html.match(/data-testid="vision-waiting-item"/g) ?? []).length).toBe(2);
    expect(html).toContain('href="/ingest/review/c1"');
    expect(html).toContain('href="/ingest/review/c2"');
    expect(html).toContain('aria-label="Check slip.jpg, page 2"');
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain("Rates, slip.jpg");
    expect((html.match(/Someone who can see prices must check this table\./g) ?? []).length).toBe(1);
    // Read only: no button on the list.
    expect(html).not.toContain("<button");
  });

  test("empty: the check-only page says so; the admin's Imports page shows nothing", () => {
    expect(render(createElement(screens.VisionWaitingList, { items: [], alwaysShow: true }), "office")).toContain("No table is waiting for a check.");
    expect(render(createElement(screens.VisionWaitingList, { items: [], alwaysShow: false }), "admin")).toBe("");
  });
});
