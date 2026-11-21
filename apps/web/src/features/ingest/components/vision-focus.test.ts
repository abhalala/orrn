import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";

import type { CandidateDetail } from "../lib";

/**
 * Focus in the page check, in a DOM (web review S3): after "Fix this cell" is cancelled or saved, focus goes back to that
 * row's "Fix this cell" button, never to the page body.
 */

const dom = new Window({ url: "http://localhost/ingest/review/c1" });
const globalNames = ["window", "document", "navigator", "Element", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "MutationObserver", "getComputedStyle"] as const;
const previous = new Map<string, PropertyDescriptor | undefined>();

let server: ViteDevServer;
let react: typeof import("react");
let client: typeof import("react-dom/client");
let query: typeof import("@tanstack/react-query");
let lib: typeof import("../lib");
let VisionCheckPanel: typeof import("./vision-check-panel").VisionCheckPanel;

beforeAll(async () => {
  for (const name of globalNames) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: (dom as unknown as Record<string, unknown>)[name] });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
  react = await import("react");
  client = await import("react-dom/client");
  query = await import("@tanstack/react-query");
  const i18n = await server.ssrLoadModule("@orrn/i18n");
  await i18n.loadMessages("en");
  lib = await server.ssrLoadModule("/src/features/ingest/lib/index.ts");
  VisionCheckPanel = (await server.ssrLoadModule("/src/features/ingest/components/vision-check-panel.tsx")).VisionCheckPanel;
}, 30_000);

afterAll(async () => {
  lib?.setVisionApiForTests(null);
  await server?.close();
  await dom.happyDOM.close();
  for (const name of globalNames) {
    const d = previous.get(name);
    if (d) Object.defineProperty(globalThis, name, d);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

const vision = { page: 2, table: 0, pageCount: 3, rowConfidence: [0.95, 0.4, 0.9], lowRows: [1] };
const detail = (): CandidateDetail =>
  ({
    id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target: "dies", holeRef: null, holeName: null,
    fit: "exact", fitScore: 1000, state: "ready", reasonCode: null, reasonDetail: null, serverSeq: 3, dryCursor: 0,
    counts: { total: 3, create: 3, update: 0, unchanged: 0, ambiguous: 0, conflict: 0, refused: 0, skipped: 0, written: 0 },
    openQuestions: 0, botAttempts: 0, recipeLocked: false, fileName: "scan.pdf", sheetName: null,
    blockOrdinal: 5, updatedAt: 0, recipe: null, fitDiff: null, questions: [],
    block: {
      id: "b1", ordinal: 5, sheetName: null, title: null, headerRow: 0, headerRows: 1,
      headers: ["Code", "Name"], kinds: ["code", "text"], headerKey: "code|name", columnCount: 2, rowCount: 3, rowsPut: 3,
      sample: [], readBy: "model", modelChecked: false, vision,
    },
    period: null, periodConfirmed: null, rowsMissing: 0,
  }) as unknown as CandidateDetail;

async function mount() {
  const c = detail();
  const qc = new query.QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData([["auth", "me"], { type: "query" }], { company: { role: "owner", settings: {} }, isPlatformAdmin: false });
  qc.setQueryData(lib.visionKeys.rows(c.id), [
    { id: "r0", rowIndex: 0, raw: ["R100", "Angle"] },
    { id: "r1", rowIndex: 1, raw: ["R1O1", ""] },
    { id: "r2", rowIndex: 2, raw: ["R102", "Channel"] },
  ]);
  qc.setQueryData(lib.visionKeys.image(c.artifactId, 2), { url: "http://localhost/page.jpg", expiresAt: Date.now() + 600_000 });
  const bar = lib.decisionBar(c, { can: { merge: true, upload: true }, botReady: true, editorOpen: false });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = client.createRoot(host as unknown as Element);
  await react.act(async () => {
    root.render(
      react.createElement(query.QueryClientProvider, { client: qc }, react.createElement(VisionCheckPanel, { candidate: c, bar, approveBusy: false, approveWorking: false, onApprove: () => {}, tickRef: () => {} })),
    );
  });
  const fixButton = (n: number) => host.querySelector(`button[aria-label="Fix this cell, Row ${n}"]`) as unknown as HTMLButtonElement;
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as unknown as HTMLButtonElement;
  return { c, host, root, fixButton, button, unmount: () => react.act(async () => root.unmount()) };
}

describe("focus after Fix this cell (S3)", () => {
  test("Cancel gives focus back to that row's Fix this cell button", async () => {
    const m = await mount();
    await react.act(async () => m.fixButton(3).click());
    expect(m.host.querySelector('[data-testid="vision-fix"]')).not.toBeNull();
    await react.act(async () => m.button("Cancel").click());
    expect(m.host.querySelector('[data-testid="vision-fix"]')).toBeNull();
    expect(document.activeElement).toBe(m.fixButton(3) as never);
    await m.unmount();
  });

  test("Save gives focus back to that row's Fix this cell button", async () => {
    const saved: unknown[] = [];
    lib.setVisionApiForTests({
      fixCell: async (input: unknown) => {
        saved.push(input);
        return detail();
      },
    } as never);
    const m = await mount();
    await react.act(async () => m.fixButton(1).click());
    await react.act(async () => m.button("Save the cell").click());
    await react.act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(saved).toHaveLength(1);
    expect(m.host.querySelector('[data-testid="vision-fix"]')).toBeNull();
    expect(document.activeElement).toBe(m.fixButton(1) as never);
    await m.unmount();
  });
});
